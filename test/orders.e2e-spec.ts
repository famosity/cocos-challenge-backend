import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { DatabaseService } from '../src/database/database.service.js';
import { useTestDatabase } from './use-test-database.js';

useTestDatabase();

const userId = 3;
const pesos = 66;

describe('POST /orders', () => {
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
      `DELETE FROM orders
       WHERE userid = $1
          OR instrumentid IN (SELECT id FROM instruments WHERE ticker LIKE 'O2%')`,
      [userId],
    );
    await database.query(
      `DELETE FROM marketdata WHERE instrumentid IN (SELECT id FROM instruments WHERE ticker LIKE 'O2%')`,
    );
    await database.query(`DELETE FROM instruments WHERE ticker LIKE 'O2%'`);
  });

  afterAll(async () => {
    await app.close();
  });

  it('fills a market buy for the shares the amount can pay and leaves the remainder', async () => {
    const instrumentId = await insertInstrument(database, 'O2MKT', '100.00');
    await cashIn(database, 1000);

    const response = await post(app, { instrumentId, side: 'BUY', type: 'MARKET', amount: '950.00' });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('FILLED');
    const account = await portfolio(app);
    expect(account.availableCash).toBe('100.00');
    expect(account.positions).toEqual([
      expect.objectContaining({
        instrumentId,
        ticker: 'O2MKT',
        quantity: 9,
        marketValue: '900.00',
      }),
    ]);
  });

  it('rejects a buy whose requested amount is above the cash and saves the calculated size', async () => {
    const instrumentId = await insertInstrument(database, 'O2BIG', '100.00');
    await cashIn(database, 1000);
    const before = await countOrders(database);

    const response = await post(app, { instrumentId, side: 'BUY', type: 'MARKET', amount: '1050.00' });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ status: 'REJECTED', reason: 'INSUFFICIENT_FUNDS' });
    expect(await saved(database, response.body.id)).toMatchObject({ size: 10, status: 'REJECTED' });
    expect(await countOrders(database)).toBe(before + 1);
    expect((await portfolio(app)).availableCash).toBe('1000.00');
  });

  it('opens a limit buy as new and makes the next buy see the reserve', async () => {
    const instrumentId = await insertInstrument(database, 'O2LIM', '100.00');
    await cashIn(database, 1000);

    const first = await post(app, { instrumentId, side: 'BUY', type: 'LIMIT', quantity: 6, price: '100.00' });
    const second = await post(app, { instrumentId, side: 'BUY', type: 'LIMIT', quantity: 5, price: '100.00' });

    expect(first.status).toBe(201);
    expect(first.body.status).toBe('NEW');
    expect(second.body).toMatchObject({ status: 'REJECTED', reason: 'INSUFFICIENT_FUNDS' });
    expect((await portfolio(app)).availableCash).toBe('400.00');
    expect((await portfolio(app)).positions).toEqual([]);
  });

  it('fills a market sale of 9 shares and rejects the same sale when only 8 are free', async () => {
    const instrumentId = await insertInstrument(database, 'O2SEL', '100.00');
    await shareLot(database, instrumentId, 9);

    const filled = await post(app, { instrumentId, side: 'SELL', type: 'MARKET', amount: '950.00' });
    expect(filled.body.status).toBe('FILLED');
    expect(await saved(database, filled.body.id)).toMatchObject({ size: 9, status: 'FILLED' });

    await database.query(`DELETE FROM orders WHERE id = $1`, [filled.body.id]);
    await shareLot(database, instrumentId, -1);

    const rejected = await post(app, { instrumentId, side: 'SELL', type: 'MARKET', amount: '950.00' });
    expect(rejected.body).toMatchObject({ status: 'REJECTED', reason: 'INSUFFICIENT_SHARES' });
    expect(await saved(database, rejected.body.id)).toMatchObject({ size: 9, status: 'REJECTED' });
  });

  it('keeps the holding when a limit sale is new and rejects a sale that crosses the reserve', async () => {
    const instrumentId = await insertInstrument(database, 'O2RSV', '100.00');
    await shareLot(database, instrumentId, 10);

    const reserved = await post(app, { instrumentId, side: 'SELL', type: 'LIMIT', quantity: 4, price: '100.00' });
    const blocked = await post(app, { instrumentId, side: 'SELL', type: 'LIMIT', quantity: 7, price: '100.00' });

    expect(reserved.body.status).toBe('NEW');
    expect(blocked.body).toMatchObject({ status: 'REJECTED', reason: 'INSUFFICIENT_SHARES' });
    expect((await portfolio(app)).positions[0]).toMatchObject({ quantity: 10 });
  });

  it('rejects a sale against a short and fills a buy that leaves the position negative', async () => {
    const instrumentId = await insertInstrument(database, 'O2SHT', '100.00');
    await cashIn(database, 4000);
    await seedOrder(database, instrumentId, 10, '100.00', 'SELL', 'FILLED', 'MARKET');

    const sale = await post(app, { instrumentId, side: 'SELL', type: 'MARKET', quantity: 1 });
    const buy = await post(app, { instrumentId, side: 'BUY', type: 'MARKET', quantity: 6 });

    expect(sale.body).toMatchObject({ status: 'REJECTED', reason: 'INSUFFICIENT_SHARES' });
    expect(buy.body.status).toBe('FILLED');
    expect((await portfolio(app)).positions[0]).toMatchObject({ quantity: -4, marketValue: '-400.00' });
  });

  it('fills a market buy at the dated close and ignores an undated row', async () => {
    const instrumentId = await insertInstrument(database, 'O2DAT');
    await addClose(database, instrumentId, null, '0.00');
    await addClose(database, instrumentId, '2024-01-02', '100.00');
    await cashIn(database, 1000);

    const response = await post(app, { instrumentId, side: 'BUY', type: 'MARKET', quantity: 1 });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('FILLED');
    expect(await saved(database, response.body.id)).toMatchObject({ price: '100.00', status: 'FILLED' });
    expect(await portfolio(app)).toMatchObject({
      availableCash: '900.00',
      totalValue: '1000.00',
      positions: [expect.objectContaining({ quantity: 1, marketValue: '100.00', totalReturnPct: 0 })],
    });
  });

  it('uses the higher id when two closes share the same date', async () => {
    const instrumentId = await insertInstrument(database, 'O2TIE');
    await addClose(database, instrumentId, '2024-01-02', '50.00');
    await addClose(database, instrumentId, '2024-01-02', '120.00');
    await cashIn(database, 1000);

    const response = await post(app, { instrumentId, side: 'BUY', type: 'MARKET', quantity: 1 });

    expect(response.body.status).toBe('FILLED');
    expect(await saved(database, response.body.id)).toMatchObject({ price: '120.00' });
    expect((await portfolio(app)).positions[0]).toMatchObject({ marketValue: '120.00' });
  });

  it('returns 422 and leaves the holding unvalued when the latest dated close is zero', async () => {
    const instrumentId = await insertInstrument(database, 'O2ZER2');
    await addClose(database, instrumentId, '2024-01-01', '80.00');
    await addClose(database, instrumentId, '2024-01-02', '0.00');
    await addClose(database, instrumentId, null, '200.00');
    await cashIn(database, 1000);
    await seedOrder(database, instrumentId, 4, '100.00', 'BUY', 'FILLED', 'MARKET');
    const before = await countOrders(database);

    const response = await post(app, { instrumentId, side: 'BUY', type: 'MARKET', quantity: 1 });

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ code: 'QUOTE_UNAVAILABLE' });
    expect(await countOrders(database)).toBe(before);
    expect(await portfolio(app)).toMatchObject({
      availableCash: '600.00',
      totalValue: null,
      positions: [expect.objectContaining({ quantity: 4, marketValue: null, totalReturnPct: null })],
    });
  });

  it('returns 422 when the latest dated close is missing or negative', async () => {
    const missing = await insertInstrument(database, 'O2NUL');
    await addClose(database, missing, '2024-01-01', '40.00');
    await addClose(database, missing, '2024-01-02', null);
    const negative = await insertInstrument(database, 'O2NEG');
    await addClose(database, negative, '2024-01-01', '40.00');
    await addClose(database, negative, '2024-01-02', '-1.00');
    await cashIn(database, 1000);
    await seedOrder(database, missing, 1, '100.00', 'BUY', 'FILLED', 'MARKET');
    await seedOrder(database, negative, 1, '100.00', 'BUY', 'FILLED', 'MARKET');
    const before = await countOrders(database);

    const missingClose = await post(app, { instrumentId: missing, side: 'BUY', type: 'MARKET', quantity: 1 });
    const negativeClose = await post(app, { instrumentId: negative, side: 'SELL', type: 'MARKET', quantity: 1 });

    expect(missingClose.status).toBe(422);
    expect(missingClose.body.code).toBe('QUOTE_UNAVAILABLE');
    expect(negativeClose.status).toBe(422);
    expect(negativeClose.body.code).toBe('QUOTE_UNAVAILABLE');
    expect(await countOrders(database)).toBe(before);
    const account = await portfolio(app);
    expect(account.totalValue).toBeNull();
    expect(account.availableCash).toBe('800.00');
    expect(account.positions).toEqual([
      expect.objectContaining({ ticker: 'O2NEG', quantity: 1, marketValue: null }),
      expect.objectContaining({ ticker: 'O2NUL', quantity: 1, marketValue: null }),
    ]);
  });

  it('opens a limit buy at the given price when the latest close is zero', async () => {
    const instrumentId = await insertInstrument(database, 'O2LIM0');
    await addClose(database, instrumentId, '2024-01-01', '80.00');
    await addClose(database, instrumentId, '2024-01-02', '0.00');
    await cashIn(database, 1000);

    const response = await post(app, { instrumentId, side: 'BUY', type: 'LIMIT', quantity: 1, price: '100.00' });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('NEW');
    expect(await saved(database, response.body.id)).toMatchObject({ price: '100.00', status: 'NEW' });
  });

  it('decides a buy the same way when cancelled and rejected rows have no price', async () => {
    const instrumentId = await insertInstrument(database, 'O2IGN', '100.00');
    await cashIn(database, 1000);
    await orderWithoutPrice(database, instrumentId, 'CANCELLED');
    await orderWithoutPrice(database, instrumentId, 'REJECTED');

    const response = await post(app, { instrumentId, side: 'BUY', type: 'MARKET', quantity: 1 });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('FILLED');
    expect(await saved(database, response.body.id)).toMatchObject({ size: 1, price: '100.00', status: 'FILLED' });
    expect((await portfolio(app)).availableCash).toBe('900.00');
  });

  it('returns 500 and writes nothing when a filled order has no price', async () => {
    const instrumentId = await insertInstrument(database, 'O2BRK', '100.00');
    await cashIn(database, 1000);
    await orderWithoutPrice(database, instrumentId, 'FILLED');
    const before = await countOrders(database);

    const response = await post(app, { instrumentId, side: 'BUY', type: 'MARKET', quantity: 1 });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Error interno',
      requestId: response.headers['x-request-id'],
    });
    expect(await countOrders(database)).toBe(before);
  });

  it('returns 422 and writes nothing when the amount buys no shares or the close is missing', async () => {
    const priced = await insertInstrument(database, 'O2ZER', '100.00');
    const bare = await insertInstrument(database, 'O2NOC');
    await cashIn(database, 1000);
    const before = await countOrders(database);

    const zero = await post(app, { instrumentId: priced, side: 'BUY', type: 'MARKET', amount: '80.00' });
    const missing = await post(app, { instrumentId: bare, side: 'BUY', type: 'MARKET', quantity: 1 });

    expect(zero.status).toBe(422);
    expect(zero.body).toMatchObject({ code: 'ZERO_ORDER_QUANTITY' });
    expect(missing.status).toBe(422);
    expect(missing.body).toMatchObject({ code: 'QUOTE_UNAVAILABLE' });
    expect(await countOrders(database)).toBe(before);
  });

  it('rejects a limit price above the column maximum and still rejects a price that fits when the cash does not', async () => {
    const instrumentId = await insertInstrument(database, 'O2PRC', '100.00');
    await cashIn(database, 1000);
    const before = await countOrders(database);

    const tooHigh = await post(app, {
      instrumentId,
      side: 'BUY',
      type: 'LIMIT',
      quantity: 1,
      price: '100000000.00',
    });

    expect(tooHigh.status).toBe(400);
    expect(tooHigh.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ field: 'price', message: 'must be at most 99999999.99' }],
    });
    expect(await countOrders(database)).toBe(before);

    const atMax = await post(app, {
      instrumentId,
      side: 'BUY',
      type: 'LIMIT',
      quantity: 1,
      price: '99999999.99',
    });

    expect(atMax.status).toBe(201);
    expect(atMax.body).toMatchObject({ status: 'REJECTED', reason: 'INSUFFICIENT_FUNDS' });
    expect(await saved(database, atMax.body.id)).toMatchObject({
      size: 1,
      price: '99999999.99',
      status: 'REJECTED',
    });
  });

  it('rejects an amount that would buy more shares than the column allows', async () => {
    const instrumentId = await insertInstrument(database, 'O2QTY', '1.00');
    const before = await countOrders(database);

    const tooMany = await post(app, { instrumentId, side: 'BUY', type: 'MARKET', amount: '2147483648.00' });

    expect(tooMany.status).toBe(422);
    expect(tooMany.body).toMatchObject({ code: 'ORDER_QUANTITY_OUT_OF_RANGE' });
    expect(await countOrders(database)).toBe(before);

    const atMax = await post(app, { instrumentId, side: 'BUY', type: 'MARKET', amount: '2147483647.00' });

    expect(atMax.status).toBe(201);
    expect(atMax.body).toMatchObject({ status: 'REJECTED', reason: 'INSUFFICIENT_FUNDS' });
    expect(await saved(database, atMax.body.id)).toMatchObject({ size: 2147483647, price: '1.00', status: 'REJECTED' });
  });

  it('rejects a buy or a sale of the cash instrument and leaves the balance untouched', async () => {
    await cashIn(database, 1000);
    await seedOrder(database, pesos, 200, '1.00', 'CASH_OUT', 'FILLED', 'MARKET');
    const before = await countOrders(database);

    for (const side of ['BUY', 'SELL'] as const) {
      for (const type of ['MARKET', 'LIMIT'] as const) {
        const response = await post(
          app,
          type === 'LIMIT'
            ? { instrumentId: pesos, side, type, quantity: 1, price: '1.00' }
            : { instrumentId: pesos, side, type, quantity: 1 },
        );
        expect(response.status).toBe(422);
        expect(response.body.code).toBe('INSTRUMENT_NOT_TRADABLE');
      }
    }

    expect(await countOrders(database)).toBe(before);
    expect(await portfolio(app)).toMatchObject({
      availableCash: '800.00',
      positions: [],
    });
  });

  it('returns 404 for an unknown user or instrument and 400 for a bad body', async () => {
    const instrumentId = await insertInstrument(database, 'O2BAD', '100.00');

    const missingUser = await request(app.getHttpServer()).post('/orders').send({
      userId: 99999,
      instrumentId,
      side: 'BUY',
      type: 'MARKET',
      quantity: 1,
    });
    const missingInstrument = await post(app, { instrumentId: 999999, side: 'BUY', type: 'MARKET', quantity: 1 });
    const pricedMarket = await post(app, { instrumentId, side: 'BUY', type: 'MARKET', quantity: 1, price: '100.00' });

    expect(missingUser.status).toBe(404);
    expect(missingUser.body.code).toBe('USER_NOT_FOUND');
    expect(missingInstrument.status).toBe(404);
    expect(missingInstrument.body.code).toBe('INSTRUMENT_NOT_FOUND');
    expect(pricedMarket.status).toBe(400);
    expect(pricedMarket.body.details).toEqual([{ field: 'price', message: 'must not be sent with MARKET' }]);
    expect(await countOrders(database)).toBe(0);
  });

  it('lets two market buys compete for the same user and keeps the cash that remains', async () => {
    const instrumentId = await insertInstrument(database, 'O2CON', '100.00');
    await cashIn(database, 1000);
    const body = { userId, instrumentId, side: 'BUY', type: 'MARKET', amount: '800.00' };
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const holder = await pool.connect();
    let pending: Promise<request.Response[]> | undefined;

    try {
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
      pending = Promise.all([
        request(app.getHttpServer()).post('/orders').send(body),
        request(app.getHttpServer()).post('/orders').send(body),
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
      const statuses = responses
        .map((response) => String(response.body.status))
        .sort((left, right) => left.localeCompare(right));

      expect(responses.every((response) => response.status === 201)).toBe(true);
      expect(statuses).toEqual(['FILLED', 'REJECTED']);
      expect((await portfolio(app)).availableCash).toBe('200.00');
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      holder.release();
      await pool.end();
      await Promise.allSettled([pending]);
    }
  }, 15_000);
});

function post(
  app: INestApplication<App>,
  body: Record<string, unknown>,
): Promise<request.Response> {
  return request(app.getHttpServer())
    .post('/orders')
    .send({ userId, ...body });
}

async function portfolio(app: INestApplication<App>): Promise<{
  totalValue: string | null;
  availableCash: string;
  positions: Array<{
    instrumentId: number;
    ticker: string;
    quantity: number;
    marketValue: string | null;
    totalReturnPct: number | null;
  }>;
}> {
  const response = await request(app.getHttpServer()).get(`/users/${userId}/portfolio`).expect(200);
  return response.body;
}

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

async function addClose(
  database: DatabaseService,
  instrumentId: number,
  date: string | null,
  close: string | null,
): Promise<void> {
  await database.query(`INSERT INTO marketdata (instrumentid, date, close) VALUES ($1, $2, $3)`, [
    instrumentId,
    date,
    close,
  ]);
}

async function orderWithoutPrice(database: DatabaseService, instrumentId: number, status: string): Promise<void> {
  await database.query(
    `INSERT INTO orders (instrumentid, userid, size, price, side, status, type, datetime)
     VALUES ($1, $2, 1, NULL, 'BUY', $3, 'MARKET', '2020-01-01')`,
    [instrumentId, userId, status],
  );
}

async function cashIn(database: DatabaseService, amount: number): Promise<void> {
  await seedOrder(database, pesos, amount, '1.00', 'CASH_IN', 'FILLED', 'MARKET');
}

async function shareLot(database: DatabaseService, instrumentId: number, size: number): Promise<void> {
  const side = size < 0 ? 'SELL' : 'BUY';
  await seedOrder(database, instrumentId, Math.abs(size), '100.00', side, 'FILLED', 'MARKET');
}

async function seedOrder(
  database: DatabaseService,
  instrumentId: number,
  size: number,
  price: string,
  side: string,
  status: string,
  type: string,
): Promise<void> {
  await database.query(
    `INSERT INTO orders (instrumentid, userid, size, price, side, status, type, datetime)
     VALUES ($1, $2, $3, $4, $5, $6, $7, '2020-01-01')`,
    [instrumentId, userId, size, price, side, status, type],
  );
}

async function saved(database: DatabaseService, id: number): Promise<{ size: number; price: string; status: string }> {
  const rows = await database.query<{ size: number; price: string; status: string }>(
    `SELECT size, price::text AS price, status FROM orders WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) throw new Error('saved order was not found');
  return row;
}

async function countOrders(database: DatabaseService): Promise<number> {
  const rows = await database.query<{ n: number }>(`SELECT count(*)::int AS n FROM orders WHERE userid = $1`, [userId]);
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
