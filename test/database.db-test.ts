import { afterAll, describe, expect, it } from 'vitest';
import { DatabaseService } from '../src/database/database.service.js';
import { useTestDatabase } from './use-test-database.js';

useTestDatabase();

describe('local database', () => {
  const database = new DatabaseService();

  it('connects and reads the users loaded from database.sql', async () => {
    const rows = await database.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM users');
    expect(rows[0]?.count).toBe('4');
  });

  afterAll(async () => {
    await database.onModuleDestroy();
  });

  it('sees the instruments, orders and market data from the same file', async () => {
    const rows = await database.query<{ instruments: string; orders: string; quotes: string }>(
      `SELECT
         (SELECT COUNT(*)::text FROM instruments) AS instruments,
         (SELECT COUNT(*)::text FROM orders) AS orders,
         (SELECT COUNT(*)::text FROM marketdata) AS quotes`,
    );
    expect(Number(rows[0]?.instruments)).toBeGreaterThan(0);
    expect(Number(rows[0]?.orders)).toBeGreaterThan(0);
    expect(Number(rows[0]?.quotes)).toBeGreaterThan(0);
  });
});
