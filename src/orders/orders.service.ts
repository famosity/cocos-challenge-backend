import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { DatabaseService } from '../database/database.service.js';
import { cashAndShares, type TradeOrder } from '../portfolio/portfolio.calc.js';
import { decideOrder } from './orders.decide.js';
import type { ParsedOrder } from './orders.parse.js';
import { OrdersRepository, type OrderRow } from './orders.repository.js';

export type PlacedOrder = {
  id: number;
  status: 'FILLED' | 'NEW' | 'REJECTED';
  reason?: 'INSUFFICIENT_FUNDS' | 'INSUFFICIENT_SHARES';
};

const unprocessableMessage = {
  ZERO_ORDER_QUANTITY: 'El monto no alcanza para una acción',
  QUOTE_UNAVAILABLE: 'No hay cotización disponible',
} as const;

@Injectable()
export class OrdersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly orders: OrdersRepository,
  ) {}

  place(order: ParsedOrder): Promise<PlacedOrder> {
    return this.database.transaction(async (query) => {
      const user = await this.orders.lockUser(query, order.userId);
      if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'El usuario no existe');

      const instrument = await this.orders.instrumentExists(query, order.instrumentId);
      if (!instrument) throw new AppError(404, 'INSTRUMENT_NOT_FOUND', 'El instrumento no existe');

      const close = order.type === 'MARKET' ? await this.orders.latestClose(query, order.instrumentId) : null;
      const history = await this.orders.findOrders(query, order.userId);
      const available = cashAndShares(history.map(toTrade), order.instrumentId);
      const decision = decideOrder(
        order,
        available.availableCashCents,
        available.availableShares,
        close === null ? null : toCents(close),
      );

      if (decision.outcome === 'unprocessable') {
        throw new AppError(422, decision.code, unprocessableMessage[decision.code]);
      }

      const id = await this.orders.insert(query, {
        userId: order.userId,
        instrumentId: order.instrumentId,
        size: decision.size,
        price: fromCents(decision.priceCents),
        side: order.side,
        type: order.type,
        status: decision.status,
      });

      return decision.outcome === 'reject'
        ? { id, status: decision.status, reason: decision.reason }
        : { id, status: decision.status };
    });
  }
}

function toTrade(order: OrderRow): TradeOrder {
  return {
    instrumentId: order.instrumentId,
    size: Number(order.size),
    priceCents: toCents(order.price),
    type: order.type,
    side: order.side,
    status: order.status,
  };
}

function toCents(price: string): number {
  const negative = price.startsWith('-');
  const [whole, fraction = ''] = price.replace('-', '').split('.');
  const cents = Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
  return negative ? -cents : cents;
}

function fromCents(cents: number): string {
  const absolute = Math.abs(cents);
  const text = `${Math.trunc(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
  return cents < 0 ? `-${text}` : text;
}
