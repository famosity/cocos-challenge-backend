import { type OnModuleDestroy } from '@nestjs/common';
import { type QueryResultRow } from 'pg';
export declare class DatabaseService implements OnModuleDestroy {
    private pool;
    query<T extends QueryResultRow>(sql: string, values?: unknown[]): Promise<T[]>;
    onModuleDestroy(): Promise<void>;
    private getPool;
}
