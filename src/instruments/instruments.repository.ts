import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';

export type InstrumentRow = {
  id: number;
  ticker: string;
  name: string;
  type: string;
};

@Injectable()
export class InstrumentsRepository {
  constructor(private readonly database: DatabaseService) {}

  search(term: string): Promise<InstrumentRow[]> {
    const pattern = escapeLike(term);
    return this.database.query<InstrumentRow>(
      `SELECT id, ticker, name, type
       FROM instruments
       WHERE ticker ILIKE '%' || $1 || '%' ESCAPE '\\'
          OR name ILIKE '%' || $1 || '%' ESCAPE '\\'
       ORDER BY CASE WHEN lower(ticker) = lower($2) THEN 0 ELSE 1 END,
                ticker ASC,
                id ASC`,
      [pattern, term],
    );
  }
}

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (character) => `\\${character}`);
}
