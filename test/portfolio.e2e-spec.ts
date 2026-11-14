import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { DatabaseService } from '../src/database/database.service.js';
import { loadEnvFile } from '../src/load-env.js';

loadEnvFile();

const pesos = 66;

describe('GET /users/:userId/portfolio', () => {
  let app: INestApplication<App>;
  let database: DatabaseService;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set');
    }
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    database = moduleFixture.get(DatabaseService);
    await app.init();
  });

  afterEach(async () => {
    await database.query(
      `DELETE FROM orders
       WHERE userid = 2
          OR instrumentid IN (SELECT id FROM instruments WHERE ticker LIKE 'P2%')`,
    );
    await database.query(
      `DELETE FROM marketdata WHERE instrumentid IN (SELECT id FROM instruments WHERE ticker LIKE 'P2%')`,
    );
    await database.query(`DELETE FROM instruments WHERE ticker LIKE 'P2%'`);
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns the seeded account of user 1', async () => {
    const response = await request(app.getHttpServer()).get('/users/1/portfolio').expect(200);

    expect(response.body).toEqual({
      totalValue: '889756.00',
      availableCash: '627500.00',
      positions: [
        {
          instrumentId: 31,
          ticker: 'BMA',
          quantity: -10,
          marketValue: '-15028.00',
          totalReturnPct: null,
        },
        {
          instrumentId: 54,
          ticker: 'METR',
          quantity: 500,
          marketValue: '114750.00',
          totalReturnPct: -8.2,
        },
        {
          instrumentId: 47,
          ticker: 'PAMP',
          quantity: 40,
          marketValue: '37034.00',
          totalReturnPct: -0.45,
        },
      ],
    });
  });

  it('returns zero amounts for a user without movements', async () => {
    const response = await request(app.getHttpServer()).get('/users/4/portfolio').expect(200);

    expect(response.body).toEqual({
      totalValue: '0.00',
      availableCash: '0.00',
      positions: [],
    });
  });

  it('returns 404 when the user does not exist', async () => {
    const response = await request(app.getHttpServer()).get('/users/99999/portfolio').expect(404);

    expect(response.body).toMatchObject({
      statusCode: 404,
      code: 'USER_NOT_FOUND',
      message: 'El usuario no existe',
    });
    expect(response.body.requestId).toBe(response.headers['x-request-id']);
  });

  it('rejects an id that is not a positive integer', async () => {
    for (const userId of ['abc', '0', '-1', '1.5']) {
      const response = await request(app.getHttpServer()).get(`/users/${userId}/portfolio`).expect(400);
      expect(response.body).toMatchObject({
        code: 'VALIDATION_ERROR',
        details: [{ field: 'userId', message: 'must be a positive integer' }],
      });
    }
  });

  it('values a short of 10 and leaves the return empty', async () => {
    const instrumentId = await insertInstrument(database, 'P2NEG', '100.00');
    await cashIn(database, 2, 4000);
    await order(database, 2, instrumentId, 10, '100.00', 'SELL', 'FILLED', 'MARKET');

    const response = await request(app.getHttpServer()).get('/users/2/portfolio').expect(200);

    expect(response.body).toMatchObject({
      totalValue: '4000.00',
      availableCash: '5000.00',
      positions: [
        {
          instrumentId,
          ticker: 'P2NEG',
          quantity: -10,
          marketValue: '-1000.00',
          totalReturnPct: null,
        },
      ],
    });
  });

  it('uses the latest close, and the higher id when the date matches', async () => {
    const instrumentId = await insertInstrument(database, 'P2CLOSE');
    await database.query(
      `INSERT INTO marketdata (instrumentid, date, close) VALUES ($1, '2024-01-01', 50), ($1, '2024-01-02', 80)`,
      [instrumentId],
    );
    await database.query(`INSERT INTO marketdata (instrumentid, date, close) VALUES ($1, '2024-01-02', 90)`, [
      instrumentId,
    ]);
    await cashIn(database, 2, 1000);
    await order(database, 2, instrumentId, 1, '100.00', 'BUY', 'FILLED', 'MARKET');

    const response = await request(app.getHttpServer()).get('/users/2/portfolio').expect(200);

    expect(response.body.positions[0]).toMatchObject({ marketValue: '90.00', totalReturnPct: -10 });
  });

  it('keeps cash when a position has no close and leaves the total empty', async () => {
    const instrumentId = await insertInstrument(database, 'P2NONE');
    await cashIn(database, 2, 1000);
    await order(database, 2, instrumentId, 1, '100.00', 'BUY', 'FILLED', 'MARKET');

    const response = await request(app.getHttpServer()).get('/users/2/portfolio').expect(200);

    expect(response.body).toMatchObject({
      totalValue: null,
      availableCash: '900.00',
      positions: [{ instrumentId, marketValue: null, totalReturnPct: null, quantity: 1 }],
    });
  });

  it('reserves cash for a new limit buy and does not add the shares', async () => {
    await cashIn(database, 2, 1000);
    await order(database, 2, pesos, 5, '100.00', 'BUY', 'NEW', 'LIMIT', pesos);

    const reserved = await request(app.getHttpServer()).get('/users/2/portfolio').expect(200);

    expect(reserved.body).toEqual({
      totalValue: '1000.00',
      availableCash: '500.00',
      positions: [],
    });
  });

  it('does not reserve a cancelled buy', async () => {
    await cashIn(database, 2, 1000);
    await order(database, 2, pesos, 5, '100.00', 'BUY', 'CANCELLED', 'LIMIT', pesos);

    const response = await request(app.getHttpServer()).get('/users/2/portfolio').expect(200);

    expect(response.body.availableCash).toBe('1000.00');
    expect(response.body.positions).toEqual([]);
  });
});

async function insertInstrument(database: DatabaseService, ticker: string, close?: string): Promise<number> {
  const rows = await database.query<{ id: number }>(
    `INSERT INTO instruments (ticker, name, type) VALUES ($1, $1, 'ACCIONES') RETURNING id`,
    [ticker],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('instrument was not inserted');
  if (close !== undefined) {
    await database.query(`INSERT INTO marketdata (instrumentid, date, close) VALUES ($1, '2024-01-02', $2)`, [
      id,
      close,
    ]);
  }
  return id;
}

async function cashIn(database: DatabaseService, userId: number, amount: number): Promise<void> {
  await order(database, userId, pesos, amount, '1.00', 'CASH_IN', 'FILLED', 'MARKET');
}

async function order(
  database: DatabaseService,
  userId: number,
  instrumentId: number,
  size: number,
  price: string,
  side: string,
  status: string,
  type: string,
  cashInstrument = instrumentId,
): Promise<void> {
  await database.query(
    `INSERT INTO orders (instrumentid, userid, size, price, side, status, type, datetime)
     VALUES ($1, $2, $3, $4, $5, $6, $7, clock_timestamp())`,
    [side === 'CASH_IN' || side === 'CASH_OUT' ? cashInstrument : instrumentId, userId, size, price, side, status, type],
  );
}
