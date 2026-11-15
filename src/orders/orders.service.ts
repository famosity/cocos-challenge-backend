import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { DatabaseService } from '../database/database.service.js';
import { cashAndShares, historyTrades, usableCloseCents } from '../portfolio/portfolio.calc.js';
import { decideOrder } from './orders.decide.js';
import type { ParsedOrder } from './orders.parse.js';
import { OrdersRepository } from './orders.repository.js';

export type PlacedOrder = {
  id: number;
  status: 'FILLED' | 'NEW' | 'REJECTED';
  reason?: 'INSUFFICIENT_FUNDS' | 'INSUFFICIENT_SHARES';
};

const unprocessableMessage = {
  ZERO_ORDER_QUANTITY: 'El monto no alcanza para una acción',
  QUOTE_UNAVAILABLE: 'No hay cotización disponible',
  ORDER_QUANTITY_OUT_OF_RANGE: 'La cantidad supera el máximo permitido',
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

      const instrumentType = await this.orders.instrumentType(query, order.instrumentId);
      if (instrumentType === null) throw new AppError(404, 'INSTRUMENT_NOT_FOUND', 'El instrumento no existe');
      if (instrumentType.toUpperCase() === 'MONEDA') {
        throw new AppError(422, 'INSTRUMENT_NOT_TRADABLE', 'El instrumento no se puede operar');
      }

      const close = order.type === 'MARKET' ? await this.orders.latestClose(query, order.instrumentId) : null;
      const history = await this.orders.findOrders(query, order.userId);
      const available = cashAndShares(historyTrades(history), order.instrumentId);
      const decision = decideOrder(
        order,
        available.availableCashCents,
        available.availableShares,
        usableCloseCents(close),
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

function fromCents(cents: number): string {
  const absolute = Math.abs(cents);
  const text = `${Math.trunc(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
  return cents < 0 ? `-${text}` : text;
}
