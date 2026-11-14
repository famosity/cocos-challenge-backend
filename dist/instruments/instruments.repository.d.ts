import { DatabaseService } from '../database/database.service.js';
export type InstrumentRow = {
    id: number;
    ticker: string;
    name: string;
    type: string;
};
export declare class InstrumentsRepository {
    private readonly database;
    constructor(database: DatabaseService);
    search(term: string): Promise<InstrumentRow[]>;
}
