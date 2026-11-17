import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createServer, type Socket } from 'node:net';
import pg from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { DatabaseService } from '../src/database/database.service.js';
import { useTestDatabase } from './use-test-database.js';

vi.mock('../src/database/database-timeouts.js', () => ({ databaseTimeouts: {
  connectionTimeoutMillis: 1_000,
  lock_timeout: 200,
  statement_timeout: 600,
  query_timeout: 1_500,
} }));

const databaseUrl = useTestDatabase();

describe('database timeouts', () => {
  let app: INestApplication<App>;
  let database: DatabaseService;
  const observer = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 3_000, query_timeout: 6_000 });

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = fixture.createNestApplication();
    app.useLogger(false);
    database = fixture.get(DatabaseService);
    await app.init();
  });

  afterAll(async () => {
    await observer.query("DELETE FROM order_idempotency WHERE key = 'timeout-order'");
    await observer.query("DELETE FROM orders WHERE userid IN (SELECT id FROM users WHERE email = 'timeout-test@example.test')");
    await observer.query("DELETE FROM users WHERE email = 'timeout-test@example.test'");
    await observer.query("DELETE FROM instruments WHERE ticker = 'TMO_TEST'");
    await app.close();
    await observer.end();
  });

  it('cancels a slow statement and keeps the pool usable', async () => {
    await expect(database.query('SELECT pg_sleep(2)')).rejects.toMatchObject({ statusCode: 503, code: 'DATABASE_UNAVAILABLE' });
    expect(await database.query('SELECT 1 AS n')).toEqual([{ n: 1 }]);
  });

  it('returns a structured HTTP 503 when a GET cannot acquire its table lock', async () => {
    const holder = await observer.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('LOCK TABLE instruments IN ACCESS EXCLUSIVE MODE');
      const response = await request(app.getHttpServer()).get('/instruments').expect(503);
      expect(response.body).toEqual({
        statusCode: 503,
        code: 'DATABASE_UNAVAILABLE',
        message: 'La base de datos no está disponible. Intentá nuevamente',
        requestId: response.headers['x-request-id'],
      });
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
    }
    await request(app.getHttpServer()).get('/instruments').expect(200);
  });

  it('leaves an order key free after a lock timeout and retries exactly once', async () => {
    const owner = await observer.query<{ id: number }>("INSERT INTO users (email, accountnumber) VALUES ('timeout-test@example.test', 'TIMEOUT') RETURNING id");
    const userId = owner.rows[0]!.id;
    const instrumentId = 34;
    await observer.query("INSERT INTO orders (userid, instrumentid, size, price, side, type, status, datetime) VALUES ($1, 66, 1000, 1, 'CASH_IN', 'MARKET', 'FILLED', statement_timestamp())", [userId]);
    const body = { userId, instrumentId, side: 'BUY', type: 'LIMIT', quantity: 8, price: '100.00' };
    const holder = await observer.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
      const response = await request(app.getHttpServer()).post('/orders').set('Idempotency-Key', 'timeout-order').send(body).expect(503);
      expect(response.body.code).toBe('DATABASE_UNAVAILABLE');
      const orders = await holder.query('SELECT count(*)::int AS n FROM orders WHERE userid = $1 AND side = $2', [userId, 'BUY']);
      expect(orders.rows[0].n).toBe(0);
      const keys = await holder.query("SELECT count(*)::int AS n FROM order_idempotency WHERE userid = $1 AND key = 'timeout-order'", [userId]);
      expect(keys.rows[0].n).toBe(0);
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
    }
    const first = await request(app.getHttpServer()).post('/orders').set('Idempotency-Key', 'timeout-order').send(body).expect(201);
    const retry = await request(app.getHttpServer()).post('/orders').set('Idempotency-Key', 'timeout-order').send(body).expect(201);
    expect(first.body.status).toBe('NEW');
    expect(retry.body).toEqual(first.body);
    const portfolio = await request(app.getHttpServer()).get(`/users/${userId}/portfolio`).expect(200);
    expect(portfolio.body.availableCash).toBe('200.00');
  });

  it('destroys a connection after a client timeout and rolls back its pending write', async () => {
    await expect(database.transaction(async (query) => {
      await query('SET LOCAL statement_timeout = 0');
      await query("INSERT INTO instruments (ticker, name, type) VALUES ('TMO_TEST', 'Timeout test', 'ACCIONES')");
      await query('SELECT pg_sleep(4)');
    })).rejects.toMatchObject({ statusCode: 503 });
    // The old backend can still be finishing pg_sleep after the socket closes.
    // Wait beyond that sleep before checking that its transaction was aborted.
    await observer.query('SELECT pg_sleep(3)');
    const rows = await observer.query("SELECT count(*)::int AS n FROM instruments WHERE ticker = 'TMO_TEST'");
    expect(rows.rows[0].n).toBe(0);
    expect(await database.query('SELECT 1 AS n')).toEqual([{ n: 1 }]);
  }, 8_000);

  it('bounds a connection attempt when TCP accepts but PostgreSQL never answers', async () => {
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server address');
    const unavailable = new DatabaseService();
    vi.stubEnv('DATABASE_URL', `postgresql://test:test@127.0.0.1:${address.port}/test`);
    try {
      await expect(unavailable.query('SELECT 1')).rejects.toMatchObject({ statusCode: 503 });
    } finally {
      vi.unstubAllEnvs();
      await unavailable.onModuleDestroy();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
