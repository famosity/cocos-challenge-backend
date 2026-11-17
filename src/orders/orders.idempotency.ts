import { validationError } from '../common/app-error.js';
import type { ParsedOrder } from './orders.parse.js';

const headerName = 'idempotency-key';
const keyPattern = /^[A-Za-z0-9._-]{1,128}$/;

export type OrderFingerprint = {
  instrumentId: number;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT';
  quantity: number | null;
  amountCents: string | null;
  priceCents: number | null;
};

export function parseIdempotencyKey(rawHeaders: readonly string[]): string | undefined {
  const values: string[] = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index];
    const value = rawHeaders[index + 1];
    if (name !== undefined && value !== undefined && name.toLowerCase() === headerName) {
      values.push(value);
    }
  }
  if (values.length === 0) return undefined;
  if (values.length > 1) throw validationError('Idempotency-Key', 'must be sent once');
  const key = values[0] ?? '';
  if (key.length === 0) throw validationError('Idempotency-Key', 'must not be empty');
  if (!keyPattern.test(key)) {
    throw validationError(
      'Idempotency-Key',
      'must be 1 to 128 letters, digits, dots, hyphens or underscores',
    );
  }
  return key;
}

export function orderFingerprint(order: ParsedOrder): OrderFingerprint {
  return {
    instrumentId: order.instrumentId,
    side: order.side,
    type: order.type,
    quantity: order.quantity ?? null,
    amountCents: order.amountCents === undefined ? null : order.amountCents.toString(),
    priceCents: order.priceCents ?? null,
  };
}

export function sameOrderFingerprint(stored: OrderFingerprint, current: OrderFingerprint): boolean {
  return (
    stored.instrumentId === current.instrumentId &&
    stored.side === current.side &&
    stored.type === current.type &&
    stored.quantity === current.quantity &&
    stored.amountCents === current.amountCents &&
    stored.priceCents === current.priceCents
  );
}

export function readOrderFingerprint(value: unknown): OrderFingerprint {
  const record = recordOf(value);
  const instrumentId = record.instrumentId;
  const side = record.side;
  const type = record.type;
  const quantity = record.quantity;
  const amountCents = record.amountCents;
  const priceCents = record.priceCents;
  if (!isInteger(instrumentId) || (side !== 'BUY' && side !== 'SELL') || (type !== 'MARKET' && type !== 'LIMIT')) {
    throw new Error('idempotency request is unreadable');
  }
  if (!isNullableInteger(quantity) || !isNullableCents(amountCents) || !isNullableInteger(priceCents)) {
    throw new Error('idempotency request is unreadable');
  }
  return { instrumentId, side, type, quantity, amountCents, priceCents };
}

function recordOf(value: unknown): Record<string, unknown> {
  const parsed = typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('idempotency record is unreadable');
  }
  return parsed as Record<string, unknown>;
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isNullableInteger(value: unknown): value is number | null {
  return value === null || isInteger(value);
}

function isNullableCents(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}
