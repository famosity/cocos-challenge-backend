import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';

export type InstrumentRow = {
  id: number;
  ticker: string;
  name: string;
  type: string;
};

const tradableInstrument = "upper(coalesce(type, '')) <> 'MONEDA'";

@Injectable()
export class InstrumentsRepository {
  constructor(private readonly database: DatabaseService) {}

  async list(limit: number, offset: string): Promise<{ items: InstrumentRow[]; totalItems: string }> {
    const [page] = await this.database.query<{ items: InstrumentRow[]; totalItems: string }>(
      `WITH tradable AS (
         SELECT id, ticker, name, type
         FROM instruments
         WHERE ${tradableInstrument}
       ),
       page AS (
         SELECT id, ticker, name, type
         FROM tradable
         ORDER BY ticker ASC, id ASC
         LIMIT $1 OFFSET $2
       )
       SELECT COALESCE(jsonb_agg(to_jsonb(page) ORDER BY ticker ASC, id ASC), '[]'::jsonb) AS items,
              (SELECT count(*) FROM tradable) AS "totalItems"
       FROM page`,
      [limit, offset],
    );
    return page;
  }

  search(term: string): Promise<InstrumentRow[]> {
    const pattern = escapeLike(term);
    return this.database.query<InstrumentRow>(
      `SELECT id, ticker, name, type
       FROM instruments
       WHERE ${tradableInstrument}
         AND (ticker ILIKE '%' || $1 || '%' ESCAPE '\\'
          OR name ILIKE '%' || $1 || '%' ESCAPE '\\')
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
