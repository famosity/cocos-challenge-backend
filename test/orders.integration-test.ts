import { Test } from '@nestjs/testing';
import type { INestApplicationContext } from '@nestjs/common';
import { DatabaseService } from '../src/database/database.service.js';
import { useTestDatabase } from './use-test-database.js';
import { OrdersRepository } from '../src/orders/orders.repository.js';
import { OrdersService } from '../src/orders/orders.service.js';
import { OrdersModule } from '../src/orders/orders.module.js';
import { PortfolioService } from '../src/portfolio/portfolio.service.js';
import { PortfolioModule } from '../src/portfolio/portfolio.module.js';

useTestDatabase();

const userId = 3;
const pesos = 66;

describe('order transaction', () => {
  let app: INestApplicationContext;
  let database: DatabaseService;
  let orders: OrdersService;
  let portfolio: PortfolioService;
  let repository: OrdersRepository;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [OrdersModule, PortfolioModule],
    }).compile();
    app = moduleRef;
    database = moduleRef.get(DatabaseService);
    orders = moduleRef.get(OrdersService);
    portfolio = moduleRef.get(PortfolioService);
    repository = moduleRef.get(OrdersRepository, { strict: false });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await database.query(
      `DELETE FROM order_idempotency
       WHERE userid = $1
          OR orderid IN (
            SELECT id FROM orders
            WHERE instrumentid IN (SELECT id FROM instruments WHERE ticker LIKE 'INT%')
          )`,
      [userId],
    );
    await database.query(
      `DELETE FROM orders
       WHERE userid = $1
          OR instrumentid IN (SELECT id FROM instruments WHERE ticker LIKE 'INT%')`,
      [userId],
    );
    await database.query(
      `DELETE FROM marketdata WHERE instrumentid IN (SELECT id FROM instruments WHERE ticker LIKE 'INT%')`,
    );
    await database.query(`DELETE FROM instruments WHERE ticker LIKE 'INT%'`);
  });

  afterAll(async () => {
    await app.close();
  });

  it('rolls back the order and the cash debit when the transaction fails', async () => {
    const instrumentId = await insertInstrument(database);
    await database.query(
      `INSERT INTO orders (instrumentid, userid, size, price, side, status, type, datetime)
       VALUES ($1, $2, 1000, 1, 'CASH_IN', 'FILLED', 'MARKET', '2020-01-01')`,
      [pesos, userId],
    );
    const before = await portfolio.get(userId);

    const insert = repository.insert.bind(repository);
    vi.spyOn(repository, 'insert').mockImplementation(async (query, order) => {
      await insert(query, order);
      throw new Error('technical failure');
    });

    await expect(
      orders.place({ userId, instrumentId, side: 'BUY', type: 'MARKET', quantity: 1 }),
    ).rejects.toThrow('technical failure');

    const after = await portfolio.get(userId);
    const buys = await database.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM orders WHERE userid = $1 AND instrumentid = $2`,
      [userId, instrumentId],
    );

    expect(before.availableCash).toBe('1000.00');
    expect(after.availableCash).toBe('1000.00');
    expect(after.positions).toEqual([]);
    expect(buys[0]?.n).toBe(0);
  });

  it('rolls back the order when the idempotency record cannot be saved and then accepts a retry', async () => {
    const instrumentId = await insertInstrument(database);
    await database.query(
      `INSERT INTO orders (instrumentid, userid, size, price, side, status, type, datetime)
       VALUES ($1, $2, 1000, 1, 'CASH_IN', 'FILLED', 'MARKET', '2020-01-01')`,
      [pesos, userId],
    );
    const key = 'retry-after-rollback';
    const save = repository.saveIdempotency.bind(repository);
    const spy = vi.spyOn(repository, 'saveIdempotency').mockImplementation(async (query, record) => {
      await save(query, record);
      throw new Error('idempotency failure');
    });

    try {
      await expect(
        orders.place({ userId, instrumentId, side: 'BUY', type: 'MARKET', quantity: 1 }, key),
      ).rejects.toThrow('idempotency failure');
    } finally {
      spy.mockRestore();
    }

    expect(await portfolio.get(userId)).toMatchObject({ availableCash: '1000.00', positions: [] });
    expect(await instrumentOrders(database, instrumentId)).toBe(0);
    expect(await idempotencyRows(database, key)).toBe(0);

    const placed = await orders.place({ userId, instrumentId, side: 'BUY', type: 'MARKET', quantity: 1 }, key);
    const replay = await orders.place({ userId, instrumentId, side: 'BUY', type: 'MARKET', quantity: 1 }, key);

    expect(placed.status).toBe('FILLED');
    expect(replay).toEqual(placed);
    expect(await instrumentOrders(database, instrumentId)).toBe(1);
    expect(await idempotencyRows(database, key)).toBe(1);
    expect((await portfolio.get(userId)).availableCash).toBe('900.00');
  });
});

async function instrumentOrders(database: DatabaseService, instrumentId: number): Promise<number> {
  const rows = await database.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM orders WHERE instrumentid = $1`,
    [instrumentId],
  );
  return rows[0]?.n ?? 0;
}

async function idempotencyRows(database: DatabaseService, key: string): Promise<number> {
  const rows = await database.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM order_idempotency WHERE userid = $1 AND key = $2`,
    [userId, key],
  );
  return rows[0]?.n ?? 0;
}

async function insertInstrument(database: DatabaseService): Promise<number> {
  const rows = await database.query<{ id: number }>(
    `INSERT INTO instruments (ticker, name, type) VALUES ('INTBUY', 'INTBUY', 'ACCIONES') RETURNING id`,
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('instrument was not inserted');
  await database.query(`INSERT INTO marketdata (instrumentid, date, close) VALUES ($1, '2024-01-02', 100)`, [id]);
  return id;
}
