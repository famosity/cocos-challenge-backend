import { DatabaseService } from './database.service.js';

describe('DatabaseService', () => {
  it('refuses to query when DATABASE_URL is missing', async () => {
    const previous = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const database = new DatabaseService();
      await expect(database.query('select 1')).rejects.toThrow('DATABASE_URL is not set');
      await database.onModuleDestroy();
    } finally {
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
    }
  });
});
