import { settleAccount, type TradeOrder } from '../account/account-availability.js';
import { isUsableCloseCents } from '../account/usable-close.js';

export type { TradeOrder } from '../account/account-availability.js';

export type Quote = {
  instrumentId: number;
  ticker: string;
  closeCents: number | null;
};

export type Position = {
  instrumentId: number;
  ticker: string;
  quantity: number;
  marketValue: string | null;
  totalReturnPct: number | null;
};

export type Portfolio = {
  totalValue: string | null;
  availableCash: string;
  positions: Position[];
};

export function buildPortfolio(orders: TradeOrder[], quotes: Quote[]): Portfolio {
  const { cashCents, reservedBuyCents, books } = settleAccount(orders);
  const quoteById = new Map(quotes.map((quote) => [quote.instrumentId, quote]));
  const positions: Position[] = [];
  let totalCents = cashCents;
  let missingClose = false;

  for (const [instrumentId, book] of books) {
    if (book.qty === 0) continue;
    const quote = quoteById.get(instrumentId);
    const position: Position = {
      instrumentId,
      ticker: quote?.ticker ?? '',
      quantity: book.qty,
      marketValue: null,
      totalReturnPct: null,
    };
    const closeCents = quote?.closeCents ?? null;
    if (!isUsableCloseCents(closeCents)) {
      missingClose = true;
    } else {
      const value = BigInt(book.qty) * BigInt(closeCents);
      position.marketValue = formatCents(value);
      totalCents += value;
      if (book.qty > 0 && book.avgNum !== 0n) {
        const numerator = (BigInt(closeCents) * book.avgDen - book.avgNum) * 100n;
        position.totalReturnPct = roundRatio(numerator, book.avgNum);
      }
    }
    positions.push(position);
  }

  positions.sort((left, right) => {
    if (left.ticker === right.ticker) return left.instrumentId - right.instrumentId;
    return left.ticker < right.ticker ? -1 : 1;
  });

  return {
    totalValue: missingClose ? null : formatCents(totalCents),
    availableCash: formatCents(cashCents - reservedBuyCents),
    positions,
  };
}

function formatCents(cents: bigint): string {
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  const whole = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

function roundRatio(numerator: bigint, denominator: bigint): number {
  const negative = (numerator < 0n) !== (denominator < 0n);
  const dividend = (numerator < 0n ? -numerator : numerator) * 100n;
  const divisor = denominator < 0n ? -denominator : denominator;
  let quotient = dividend / divisor;
  const remainder = dividend % divisor;
  if (remainder * 2n >= divisor) quotient += 1n;
  const rounded = negative ? -quotient : quotient;
  return Number(rounded) / 100;
}

