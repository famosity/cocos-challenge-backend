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

  async list(limit: number, offset: string, term?: string): Promise<{ items: InstrumentRow[]; totalItems: string }> {
    const pattern = term === undefined ? null : escapeLike(term);
    const [page] = await this.database.query<{ items: InstrumentRow[]; totalItems: string }>(
      `WITH matched AS (
         SELECT id, ticker, name, type,
                CASE WHEN lower(ticker) = lower($4::text) THEN 0 ELSE 1 END AS ticker_rank
         FROM instruments
         WHERE ${tradableInstrument}
           AND ($3::text IS NULL
             OR ticker ILIKE '%' || $3 || '%' ESCAPE '\\'
             OR name ILIKE '%' || $3 || '%' ESCAPE '\\')
       ),
       page AS (
         SELECT id, ticker, name, type, ticker_rank
         FROM matched
         ORDER BY ticker_rank, ticker, id
         LIMIT $1 OFFSET $2
       )
       SELECT COALESCE(jsonb_agg(to_jsonb(page) - 'ticker_rank' ORDER BY ticker_rank, ticker, id), '[]'::jsonb) AS items,
              (SELECT count(*) FROM matched) AS "totalItems"
       FROM page`,
      [limit, offset, pattern, term ?? null],
    );
    return page;
  }
}

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (character) => `\\${character}`);
}
