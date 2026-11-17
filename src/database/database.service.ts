import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { databaseError, isConnectionFailure } from './database-error.js';
import { databaseTimeouts } from './database-timeouts.js';

export type Sql = <T extends QueryResultRow>(sql: string, values?: unknown[]) => Promise<T[]>;

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private pool: Pool | undefined;
  private readonly logger = new Logger(DatabaseService.name);

  async query<T extends QueryResultRow>(sql: string, values: unknown[] = []): Promise<T[]> {
    try {
      // pg.Pool discards the connection when the query fails, including a read timeout.
      const result = await this.getPool().query<T>(sql, values);
      return result.rows;
    } catch (error) {
      throw databaseError(error);
    }
  }

  async transaction<T>(run: (query: Sql) => Promise<T>): Promise<T> {
    let client: PoolClient | undefined;
    let discard = false;
    const onConnectionError = () => {
      discard = true;
    };

    try {
      client = await this.getPool().connect();
      client.on('error', onConnectionError);
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const connection = client;
      const result = await run((sql, values) => rowsOf(connection, sql, values));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      discard ||= isConnectionFailure(error);
      if (client && !discard) {
        try {
          await client.query('ROLLBACK');
        } catch {
          discard = true;
        }
      }
      throw databaseError(error);
    } finally {
      // A client-side timeout does not cancel SQL. Close that connection so it
      // cannot be reused with an unfinished query or an uncertain transaction.
      client?.release(discard);
      client?.removeListener('error', onConnectionError);
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
    if (!this.pool) {
      this.pool = new Pool({ connectionString, ...databaseTimeouts });
      this.pool.on('error', () => {
        this.logger.error('Se perdió una conexión inactiva con PostgreSQL');
      });
    }
    return this.pool;
  }
}

async function rowsOf<T extends QueryResultRow>(client: PoolClient, sql: string, values?: unknown[]): Promise<T[]> {
  const result = await client.query<T>(sql, values ?? []);
  return result.rows;
}
