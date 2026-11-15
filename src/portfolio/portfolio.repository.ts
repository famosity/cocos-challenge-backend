import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';

export type OrderRow = {
  instrumentId: number | null;
  size: number | null;
  price: string | null;
  type: string | null;
  side: string | null;
  status: string | null;
};

export type QuoteRow = {
  instrumentId: number;
  ticker: string;
  close: string | null;
};

@Injectable()
export class PortfolioRepository {
  constructor(private readonly database: DatabaseService) {}

  async exists(userId: number): Promise<boolean> {
    const rows = await this.database.query<{ id: number }>('SELECT id FROM users WHERE id = $1', [userId]);
    return rows.length > 0;
  }

  findOrders(userId: number): Promise<OrderRow[]> {
    return this.database.query<OrderRow>(
      `SELECT instrumentid AS "instrumentId",
              size,
              price::text AS price,
              type,
              side,
              status
       FROM orders
       WHERE userid = $1
       ORDER BY datetime ASC, id ASC`,
      [userId],
    );
  }

  findQuotes(instrumentIds: number[]): Promise<QuoteRow[]> {
    return this.database.query<QuoteRow>(
      `SELECT i.id AS "instrumentId",
              i.ticker,
              q.close::text AS close
       FROM instruments i
       LEFT JOIN (
         SELECT DISTINCT ON (instrumentid) instrumentid, close
         FROM marketdata
         WHERE instrumentid = ANY($1::int[]) AND date IS NOT NULL
         ORDER BY instrumentid, date DESC, id DESC
       ) q ON q.instrumentid = i.id
       WHERE i.id = ANY($1::int[])`,
      [instrumentIds],
    );
  }
}
