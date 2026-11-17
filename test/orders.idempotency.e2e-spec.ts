import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { request as httpRequest, type Server } from 'node:http';
import pg from 'pg';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { DatabaseService } from '../src/database/database.service.js';
import { useTestDatabase } from './use-test-database.js';

useTestDatabase();

const userId = 2;
const otherUserId = 4;
const pesos = 66;

describe('POST /orders idempotency', () => {
  let app: INestApplication<App>;
  let database: DatabaseService;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    database = moduleFixture.get(DatabaseService);
    await app.init();
  });

  afterEach(async () => {
    await database.query(
      `DELETE FROM order_idempotency
       WHERE userid IN ($1, $2)
          OR orderid IN (
            SELECT id FROM orders
            WHERE userid IN ($1, $2)
               OR instrumentid IN (SELECT id FROM instruments WHERE ticker LIKE 'IDM%')
          )`,
      [userId, otherUserId],
    );
    await database.query(
      `DELETE FROM orders
       WHERE userid IN ($1, $2)
          OR instrumentid IN (SELECT id FROM instruments WHERE ticker LIKE 'IDM%')`,
      [userId, otherUserId],
    );
    await database.query(
      `DELETE FROM marketdata WHERE instrumentid IN (SELECT id FROM instruments WHERE ticker LIKE 'IDM%')`,
    );
    await database.query(`DELETE FROM instruments WHERE ticker LIKE 'IDM%'`);
  });

  afterAll(async () => {
    await app.close();
  });

  it('repeats the filled buy and leaves one order with the remaining cash', async () => {
    const instrumentId = await insertInstrument(database, 'IDM800', '100.00');
    await cashIn(database, userId, 2000);
    const body = { instrumentId, side: 'BUY', type: 'MARKET', amount: '800.00' };

    const first = await post(app, body, 'buy-800.00');
    const retry = await post(app, body, 'buy-800.00');

    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ status: 'FILLED' });
    expect(retry.status).toBe(201);
    expect(retry.body).toEqual(first.body);
    expect(retry.headers['x-request-id']).not.toBe(first.headers['x-request-id']);
    expect(await instrumentOrders(database, instrumentId)).toBe(1);
    expect(await idempotencyRows(database, userId, 'buy-800.00')).toBe(1);
    expect((await portfolio(app, userId)).availableCash).toBe('1200.00');
  });

  it('keeps a single order when two requests with the same key run together', async () => {
    const instrumentId = await insertInstrument(database, 'IDMCON', '100.00');
    await cashIn(database, userId, 2000);
    const body = { userId, instrumentId, side: 'BUY', type: 'MARKET', amount: '800.00' };
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const holder = await pool.connect();
    let pending: Promise<request.Response[]> | undefined;

    try {
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
      pending = Promise.all([
        request(app.getHttpServer()).post('/orders').set('Idempotency-Key', 'buy-together').send(body),
        request(app.getHttpServer()).post('/orders').set('Idempotency-Key', 'buy-together').send(body),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 200));
      await waitFor(async () => {
        const waiting = await holder.query<{ n: string }>(
          `SELECT count(*)::text AS n
           FROM pg_stat_activity
           WHERE state = 'active'
             AND wait_event_type = 'Lock'
             AND query ILIKE '%for update%'`,
        );
        return Number(waiting.rows[0]?.n ?? 0) >= 2;
      });
      await holder.query('COMMIT');
      const responses = await pending;

      expect(responses.every((response) => response.status === 201)).toBe(true);
      expect(responses[0]?.body).toMatchObject({ status: 'FILLED' });
      expect(responses[1]?.body).toEqual(responses[0]?.body);
      expect(await instrumentOrders(database, instrumentId)).toBe(1);
      expect(await idempotencyRows(database, userId, 'buy-together')).toBe(1);
      expect((await portfolio(app, userId)).availableCash).toBe('1200.00');
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      holder.release();
      await pool.end();
      await Promise.allSettled([pending]);
    }
  }, 15_000);

  it('returns 409 when the same key is reused for another quantity or instrument', async () => {
    const firstInstrument = await insertInstrument(database, 'IDMONE', '100.00');
    const secondInstrument = await insertInstrument(database, 'IDMTWO', '100.00');
    await cashIn(database, userId, 2000);
    const quantityKey = await post(app, { instrumentId: firstInstrument, side: 'BUY', type: 'MARKET', quantity: 1 }, 'qty');
    const instrumentKey = await post(
      app,
      { instrumentId: firstInstrument, side: 'BUY', type: 'MARKET', quantity: 1 },
      'inst',
    );

    const otherQuantity = await post(
      app,
      { instrumentId: firstInstrument, side: 'BUY', type: 'MARKET', quantity: 2 },
      'qty',
    );
    const otherInstrument = await post(
      app,
      { instrumentId: secondInstrument, side: 'BUY', type: 'MARKET', quantity: 1 },
      'inst',
    );

    expect(quantityKey.status).toBe(201);
    expect(instrumentKey.status).toBe(201);
    expect(otherQuantity.status).toBe(409);
    expect(otherQuantity.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(otherInstrument.status).toBe(409);
    expect(otherInstrument.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(await instrumentOrders(database, firstInstrument)).toBe(2);
    expect(await instrumentOrders(database, secondInstrument)).toBe(0);
  });

  it('returns 409 when quantity and amount describe the same size', async () => {
    const instrumentId = await insertInstrument(database, 'IDMSHP', '100.00');
    await cashIn(database, userId, 2000);

    const shares = await post(app, { instrumentId, side: 'BUY', type: 'MARKET', quantity: 8 }, 'shape');
    const amount = await post(app, { instrumentId, side: 'BUY', type: 'MARKET', amount: '800.00' }, 'shape');

    expect(shares.status).toBe(201);
    expect(shares.body).toMatchObject({ status: 'FILLED' });
    expect(await saved(database, shares.body.id)).toMatchObject({ size: 8, status: 'FILLED' });
    expect(await idempotencyRows(database, userId, 'shape')).toBe(1);
    expect(amount.status).toBe(409);
    expect(amount.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(await instrumentOrders(database, instrumentId)).toBe(1);
    expect((await portfolio(app, userId)).availableCash).toBe('1200.00');
  });

  it('leaves the key free when the quote is missing and accepts the same retry later', async () => {
    const instrumentId = await insertInstrument(database, 'IDMQUO');
    await cashIn(database, userId, 500);
    const body = { instrumentId, side: 'BUY', type: 'MARKET', quantity: 1 };

    const missing = await post(app, body, 'quote');

    expect(missing.status).toBe(422);
    expect(missing.body).toMatchObject({ code: 'QUOTE_UNAVAILABLE' });
    expect(await instrumentOrders(database, instrumentId)).toBe(0);
    expect(await idempotencyRows(database, userId, 'quote')).toBe(0);

    await addClose(database, instrumentId, '2024-01-02', '100.00');
    const filled = await post(app, body, 'quote');

    expect(filled.status).toBe(201);
    expect(filled.body).toMatchObject({ status: 'FILLED' });
    expect(await instrumentOrders(database, instrumentId)).toBe(1);
    expect(await idempotencyRows(database, userId, 'quote')).toBe(1);
  });

  it('repeats the original rejection after the cash changes', async () => {
    const instrumentId = await insertInstrument(database, 'IDMREJ', '100.00');
    await cashIn(database, userId, 100);
    const body = { instrumentId, side: 'BUY', type: 'MARKET', quantity: 2 };

    const rejected = await post(app, body, 'rejected');
    await cashIn(database, userId, 1000);
    const retry = await post(app, body, 'rejected');

    expect(rejected.status).toBe(201);
    expect(rejected.body).toMatchObject({ status: 'REJECTED', reason: 'INSUFFICIENT_FUNDS' });
    expect(retry.status).toBe(201);
    expect(retry.body).toEqual(rejected.body);
    expect(await instrumentOrders(database, instrumentId)).toBe(1);
    expect((await portfolio(app, userId)).availableCash).toBe('1100.00');
  });

  it('keeps separate intentions for another user, another key, and a post without the header', async () => {
    const instrumentId = await insertInstrument(database, 'IDMIND', '100.00');
    await cashIn(database, userId, 2000);
    await cashIn(database, otherUserId, 1000);
    const body = { instrumentId, side: 'BUY', type: 'MARKET', quantity: 1 };

    const firstUser = await post(app, body, 'shared');
    const secondUser = await post(app, body, 'shared', otherUserId);
    const otherKey = await post(app, body, 'other-key');
    const unkeyed = await post(app, body);
    const unkeyedAgain = await post(app, body);

    expect(firstUser.body.status).toBe('FILLED');
    expect(secondUser.body.status).toBe('FILLED');
    expect(secondUser.body.id).not.toBe(firstUser.body.id);
    expect(otherKey.body.id).not.toBe(firstUser.body.id);
    expect(unkeyed.body.id).not.toBe(unkeyedAgain.body.id);
    expect(await instrumentOrders(database, instrumentId)).toBe(5);
    expect(await idempotencyRows(database, userId, 'shared')).toBe(1);
    expect(await idempotencyRows(database, otherUserId, 'shared')).toBe(1);
    expect(await idempotencyRows(database, userId, 'other-key')).toBe(1);
  });

  it('treats abc and ABC as different keys', async () => {
    const instrumentId = await insertInstrument(database, 'IDMCASE', '100.00');
    await cashIn(database, userId, 1000);
    const body = { instrumentId, side: 'BUY', type: 'MARKET', quantity: 1 };

    const lower = await post(app, body, 'abc');
    const upper = await post(app, body, 'ABC');

    expect(lower.status).toBe(201);
    expect(upper.status).toBe(201);
    expect(lower.body.id).not.toBe(upper.body.id);
    expect(await instrumentOrders(database, instrumentId)).toBe(2);
    expect(await idempotencyRows(database, userId, 'abc')).toBe(1);
    expect(await idempotencyRows(database, userId, 'ABC')).toBe(1);
    expect((await portfolio(app, userId)).availableCash).toBe('800.00');
  });

  it('treats 800.0 and 800.00 as the same request', async () => {
    const instrumentId = await insertInstrument(database, 'IDMCNT', '100.00');
    await cashIn(database, userId, 2000);

    const first = await post(app, { instrumentId, side: 'BUY', type: 'MARKET', amount: '800.0' }, 'cents');
    const retry = await post(app, { instrumentId, side: 'BUY', type: 'MARKET', amount: '800.00' }, 'cents');

    expect(first.status).toBe(201);
    expect(retry.body).toEqual(first.body);
    expect(await instrumentOrders(database, instrumentId)).toBe(1);
    expect((await portfolio(app, userId)).availableCash).toBe('1200.00');
  });

  it('rejects an empty, repeated, or oversized idempotency key', async () => {
    const instrumentId = await insertInstrument(database, 'IDMHDR', '100.00');
    const body = { instrumentId, side: 'BUY', type: 'MARKET', quantity: 1 };
    const server = app.getHttpServer() as Server;

    const empty = await postRaw(server, [''], body);
    const repeated = await postRaw(server, ['abc', 'ABC'], body);
    const oversized = await postRaw(server, ['a'.repeat(129)], body);

    expect(empty.status).toBe(400);
    expect(empty.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ field: 'Idempotency-Key', message: 'must not be empty' }],
    });
    expect(repeated.status).toBe(400);
    expect(repeated.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ field: 'Idempotency-Key', message: 'must be sent once' }],
    });
    expect(oversized.status).toBe(400);
    expect(oversized.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [
        {
          field: 'Idempotency-Key',
          message: 'must be 1 to 128 letters, digits, dots, hyphens or underscores',
        },
      ],
    });
    expect(await instrumentOrders(database, instrumentId)).toBe(0);
    expect(await idempotencyRows(database, userId)).toBe(0);
  });
});

function post(
  app: INestApplication<App>,
  body: Record<string, unknown>,
  idempotencyKey?: string,
  ownerId = userId,
): Promise<request.Response> {
  const call = request(app.getHttpServer()).post('/orders');
  if (idempotencyKey !== undefined) call.set('Idempotency-Key', idempotencyKey);
  return call.send({ userId: ownerId, ...body });
}

function postRaw(
  server: Server,
  keys: string[],
  body: Record<string, unknown>,
): Promise<{ status: number; body: { code?: string; details?: unknown } }> {
  const payload = JSON.stringify({ userId, ...body });
  return new Promise((resolve, reject) => {
    const send = (): void => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('test server has no port'));
        return;
      }
      const req = httpRequest(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path: '/orders',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
            'Idempotency-Key': keys,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            resolve({
              status: res.statusCode ?? 0,
              body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as { code?: string; details?: unknown },
            });
          });
        },
      );
      req.on('error', reject);
      req.end(payload);
    };

    if (server.listening) {
      send();
      return;
    }
    server.listen(0, send);
  });
}

async function portfolio(app: INestApplication<App>, ownerId: number): Promise<{ availableCash: string }> {
  const response = await request(app.getHttpServer()).get(`/users/${ownerId}/portfolio`).expect(200);
  return response.body;
}

async function insertInstrument(database: DatabaseService, ticker: string, close?: string): Promise<number> {
  const rows = await database.query<{ id: number }>(
    `INSERT INTO instruments (ticker, name, type) VALUES ($1, $1, 'ACCIONES') RETURNING id`,
    [ticker],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('instrument was not inserted');
  if (close !== undefined) await addClose(database, id, '2024-01-02', close);
  return id;
}

async function addClose(
  database: DatabaseService,
  instrumentId: number,
  date: string,
  close: string,
): Promise<void> {
  await database.query(`INSERT INTO marketdata (instrumentid, date, close) VALUES ($1, $2, $3)`, [
    instrumentId,
    date,
    close,
  ]);
}

async function cashIn(database: DatabaseService, ownerId: number, amount: number): Promise<void> {
  await database.query(
    `INSERT INTO orders (instrumentid, userid, size, price, side, status, type, datetime)
     VALUES ($1, $2, $3, '1.00', 'CASH_IN', 'FILLED', 'MARKET', '2020-01-01')`,
    [pesos, ownerId, amount],
  );
}

async function saved(database: DatabaseService, id: number): Promise<{ size: number; status: string }> {
  const rows = await database.query<{ size: number; status: string }>(
    `SELECT size, status FROM orders WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) throw new Error('saved order was not found');
  return row;
}

async function instrumentOrders(database: DatabaseService, instrumentId: number): Promise<number> {
  const rows = await database.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM orders WHERE instrumentid = $1`,
    [instrumentId],
  );
  return rows[0]?.n ?? 0;
}

async function idempotencyRows(database: DatabaseService, ownerId: number, key?: string): Promise<number> {
  const rows = await database.query<{ n: number }>(
    key === undefined
      ? `SELECT count(*)::int AS n FROM order_idempotency WHERE userid = $1`
      : `SELECT count(*)::int AS n FROM order_idempotency WHERE userid = $1 AND key = $2`,
    key === undefined ? [ownerId] : [ownerId, key],
  );
  return rows[0]?.n ?? 0;
}

async function waitFor(ready: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('timed out waiting for the user lock');
}
