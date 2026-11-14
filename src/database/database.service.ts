import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';

export type Sql = <T extends QueryResultRow>(sql: string, values?: unknown[]) => Promise<T[]>;

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private pool: Pool | undefined;

  async query<T extends QueryResultRow>(sql: string, values: unknown[] = []): Promise<T[]> {
    const result = await this.getPool().query<T>(sql, values);
    return result.rows;
  }

  async transaction<T>(run: (query: Sql) => Promise<T>): Promise<T> {
    const client = await this.getPool().connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const result = await run((sql, values) => rowsOf(client, sql, values));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
    this.pool = undefined;
  }

  private getPool(): Pool {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set');
    }
    this.pool ??= new Pool({ connectionString });
    return this.pool;
  }
}

async function rowsOf<T extends QueryResultRow>(client: PoolClient, sql: string, values?: unknown[]): Promise<T[]> {
  const result = await client.query<T>(sql, values ?? []);
  return result.rows;
}
