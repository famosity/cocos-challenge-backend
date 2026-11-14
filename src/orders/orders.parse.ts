import { BadRequestException } from '@nestjs/common';
import type { OrderRequest } from './orders.decide.js';

const money = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;
const maxInt = 2147483647;

export type ParsedOrder = OrderRequest & {
  userId: number;
  instrumentId: number;
};

export function parseOrder(body: unknown): ParsedOrder {
  if (!isRecord(body)) {
    throw new BadRequestException(['body must be an object']);
  }

  const userId = positiveInt(body.userId, 'userId');
  const instrumentId = positiveInt(body.instrumentId, 'instrumentId');
  const side = oneOf(body.side, ['BUY', 'SELL'] as const, 'side must be BUY or SELL');
  const type = oneOf(body.type, ['MARKET', 'LIMIT'] as const, 'type must be MARKET or LIMIT');
  const hasQuantity = body.quantity !== undefined;
  const hasAmount = body.amount !== undefined;
  if (hasQuantity === hasAmount) {
    throw new BadRequestException(['body must include quantity or amount, not both']);
  }

  const quantity = hasQuantity ? positiveInt(body.quantity, 'quantity') : undefined;
  const amountCents = hasAmount ? moneyCents(body.amount, 'amount') : undefined;
  const priceCents = priceOf(body.price, type);

  return { userId, instrumentId, side, type, quantity, amountCents, priceCents };
}

function priceOf(value: unknown, type: 'MARKET' | 'LIMIT'): number | undefined {
  if (type === 'MARKET') {
    if (value !== undefined) throw new BadRequestException(['price must not be sent with MARKET']);
    return undefined;
  }
  if (value === undefined) throw new BadRequestException(['price must be a positive decimal']);
  return Number(moneyCents(value, 'price'));
}

function positiveInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > maxInt) {
    throw new BadRequestException([`${field} must be a positive integer`]);
  }
  return value;
}

function moneyCents(value: unknown, field: string): bigint {
  if (typeof value !== 'string' || !money.test(value)) {
    throw new BadRequestException([`${field} must be a positive decimal`]);
  }
  const [whole, fraction = ''] = value.split('.');
  const cents = BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
  if (cents <= 0n) throw new BadRequestException([`${field} must be a positive decimal`]);
  return cents;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], message: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new BadRequestException([message]);
  }
  return value as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
