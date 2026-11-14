import { Test } from '@nestjs/testing';
import type { INestApplicationContext } from '@nestjs/common';
import { DatabaseService } from '../src/database/database.service.js';
import { loadEnvFile } from '../src/load-env.js';
import { OrdersRepository } from '../src/orders/orders.repository.js';
import { OrdersService } from '../src/orders/orders.service.js';
import { OrdersModule } from '../src/orders/orders.module.js';
import { PortfolioService } from '../src/portfolio/portfolio.service.js';
import { PortfolioModule } from '../src/portfolio/portfolio.module.js';

loadEnvFile();

const userId = 3;
const pesos = 66;

describe('order transaction', () => {
  let app: INestApplicationContext;
  let database: DatabaseService;
  let orders: OrdersService;
  let portfolio: PortfolioService;
  let repository: OrdersRepository;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
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
});

async function insertInstrument(database: DatabaseService): Promise<number> {
  const rows = await database.query<{ id: number }>(
    `INSERT INTO instruments (ticker, name, type) VALUES ('INTBUY', 'INTBUY', 'ACCIONES') RETURNING id`,
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('instrument was not inserted');
  await database.query(`INSERT INTO marketdata (instrumentid, date, close) VALUES ($1, '2024-01-02', 100)`, [id]);
  return id;
}
