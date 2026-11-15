export type OrderRequest = {
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT';
  quantity?: number;
  amountCents?: bigint;
  priceCents?: number;
};

export type OrderDecision =
  | { outcome: 'unprocessable'; code: 'ZERO_ORDER_QUANTITY' | 'QUOTE_UNAVAILABLE' | 'ORDER_QUANTITY_OUT_OF_RANGE' }
  | {
      outcome: 'accept';
      status: 'FILLED' | 'NEW';
      size: number;
      priceCents: number;
    }
  | {
      outcome: 'reject';
      status: 'REJECTED';
      reason: 'INSUFFICIENT_FUNDS' | 'INSUFFICIENT_SHARES';
      size: number;
      priceCents: number;
    };

export function decideOrder(
  order: OrderRequest,
  availableCashCents: bigint,
  availableShares: number,
  closeCents: number | null,
): OrderDecision {
  if (order.type === 'MARKET' && !usableCents(closeCents)) {
    return { outcome: 'unprocessable', code: 'QUOTE_UNAVAILABLE' };
  }

  const priceCents = order.type === 'MARKET' ? closeCents : (order.priceCents ?? null);
  if (priceCents === null) {
    return { outcome: 'unprocessable', code: 'QUOTE_UNAVAILABLE' };
  }

  const sizeBig = order.quantity === undefined ? sharesFor(order.amountCents ?? 0n, priceCents) : BigInt(order.quantity);
  if (sizeBig === 0n) {
    return { outcome: 'unprocessable', code: 'ZERO_ORDER_QUANTITY' };
  }
  if (sizeBig > maxSize) {
    return { outcome: 'unprocessable', code: 'ORDER_QUANTITY_OUT_OF_RANGE' };
  }
  const size = Number(sizeBig);

  const status = order.type === 'MARKET' ? 'FILLED' : 'NEW';
  if (order.side === 'BUY') {
    const requested = order.amountCents ?? BigInt(size) * BigInt(priceCents);
    if (requested > availableCashCents) {
      return { outcome: 'reject', status: 'REJECTED', reason: 'INSUFFICIENT_FUNDS', size, priceCents };
    }
  } else if (size > availableShares) {
    return { outcome: 'reject', status: 'REJECTED', reason: 'INSUFFICIENT_SHARES', size, priceCents };
  }

  return { outcome: 'accept', status, size, priceCents };
}

function usableCents(cents: number | null): cents is number {
  return cents !== null && Number.isFinite(cents) && cents > 0;
}

const maxSize = 2_147_483_647n;

function sharesFor(amountCents: bigint, priceCents: number): bigint {
  if (priceCents <= 0) return 0n;
  return amountCents / BigInt(priceCents);
}
