import { Injectable } from '@nestjs/common';
import type { Sql } from '../database/database.service.js';

export type OrderRow = {
  instrumentId: number | null;
  size: number | null;
  price: string | null;
  type: string | null;
  side: string | null;
  status: string | null;
};

@Injectable()
export class OrdersRepository {
  lockUser(query: Sql, userId: number): Promise<boolean> {
    return query<{ id: number }>('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]).then(
      (rows) => rows.length > 0,
    );
  }

  instrumentType(query: Sql, instrumentId: number): Promise<string | null> {
    return query<{ type: string | null }>('SELECT type FROM instruments WHERE id = $1', [instrumentId]).then(
      (rows) => (rows.length === 0 ? null : (rows[0]?.type ?? '')),
    );
  }

  async latestClose(query: Sql, instrumentId: number): Promise<string | null> {
    const rows = await query<{ close: string | null }>(
      `SELECT close::text AS close
       FROM marketdata
       WHERE instrumentid = $1 AND date IS NOT NULL
       ORDER BY date DESC, id DESC
       LIMIT 1`,
      [instrumentId],
    );
    return rows[0]?.close ?? null;
  }

  findOrders(query: Sql, userId: number): Promise<OrderRow[]> {
    return query<OrderRow>(
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

  async insert(
    query: Sql,
    order: {
      userId: number;
      instrumentId: number;
      size: number;
      price: string;
      side: string;
      type: string;
      status: string;
    },
  ): Promise<number> {
    const rows = await query<{ id: number }>(
      `INSERT INTO orders (instrumentid, userid, size, price, side, type, status, datetime)
       VALUES ($1, $2, $3, $4, $5, $6, $7, statement_timestamp())
       RETURNING id`,
      [order.instrumentId, order.userId, order.size, order.price, order.side, order.type, order.status],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('order was not inserted');
    return id;
  }
}
