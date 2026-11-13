import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Pool, type QueryResultRow } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private pool: Pool | undefined;

  async query<T extends QueryResultRow>(sql: string, values: unknown[] = []): Promise<T[]> {
    const result = await this.getPool().query<T>(sql, values);
    return result.rows;
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
