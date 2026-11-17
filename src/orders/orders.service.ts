import { Injectable } from '@nestjs/common';
import { cashAndShares, historyTrades } from '../account/account-availability.js';
import { usableCloseCents } from '../account/usable-close.js';
import { AppError, userNotFound } from '../common/app-error.js';
import { DatabaseService, type Sql } from '../database/database.service.js';
import { decideOrder } from './orders.decide.js';
import { orderFingerprint, readOrderFingerprint, sameOrderFingerprint } from './orders.idempotency.js';
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

  place(order: ParsedOrder, idempotencyKey?: string): Promise<PlacedOrder> {
    return this.database.transaction(async (query) => {
      const user = await this.orders.lockUser(query, order.userId);
      if (!user) throw userNotFound();

      if (idempotencyKey !== undefined) {
        const stored = await storedOrder(this.orders, query, order, idempotencyKey);
        if (stored) return stored;
      }

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
      const placed: PlacedOrder =
        decision.outcome === 'reject'
          ? { id, status: decision.status, reason: decision.reason }
          : { id, status: decision.status };
      if (idempotencyKey !== undefined) {
        await this.orders.saveIdempotency(query, {
          userId: order.userId,
          key: idempotencyKey,
          orderId: id,
          request: orderFingerprint(order),
          response: placed,
        });
      }
      return placed;
    });
  }
}

async function storedOrder(
  orders: OrdersRepository,
  query: Sql,
  order: ParsedOrder,
  key: string,
): Promise<PlacedOrder | undefined> {
  const stored = await orders.findIdempotency(query, order.userId, key);
  if (!stored) return undefined;
  if (!sameOrderFingerprint(readOrderFingerprint(stored.request), orderFingerprint(order))) {
    throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'La clave de idempotencia ya fue usada con otros datos');
  }
  return readPlacedOrder(stored.response);
}

function readPlacedOrder(value: unknown): PlacedOrder {
  const record = recordOf(value);
  const { id, status, reason } = record;
  if (!isOrderId(id) || (status !== 'FILLED' && status !== 'NEW' && status !== 'REJECTED')) {
    throw new Error('idempotency response is unreadable');
  }
  if (reason === undefined) return { id, status };
  if (reason !== 'INSUFFICIENT_FUNDS' && reason !== 'INSUFFICIENT_SHARES') {
    throw new Error('idempotency response is unreadable');
  }
  return { id, status, reason };
}

function recordOf(value: unknown): Record<string, unknown> {
  const parsed = typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('idempotency record is unreadable');
  }
  return parsed as Record<string, unknown>;
}

function isOrderId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function fromCents(cents: number): string {
  const absolute = Math.abs(cents);
  const text = `${Math.trunc(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
  return cents < 0 ? `-${text}` : text;
}
