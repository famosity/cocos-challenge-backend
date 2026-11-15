export type TradeOrder = {
  instrumentId: number;
  size: number;
  priceCents: number;
  type: string;
  side: string;
  status: string;
};

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

type Book = {
  qty: number;
  avgNum: bigint;
  avgDen: bigint;
  sellReserved: number;
};

type Settled = {
  cashCents: bigint;
  reservedBuyCents: bigint;
  books: Map<number, Book>;
};

export function buildPortfolio(orders: TradeOrder[], quotes: Quote[]): Portfolio {
  const { cashCents, reservedBuyCents, books } = settle(orders);
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
    if (!usableCents(closeCents)) {
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

export function usableCloseCents(price: string | null): number | null {
  if (price === null) return null;
  const match = /^(\d+)(?:\.(\d+))?$/.exec(price);
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number(((match[2] ?? '') + '00').slice(0, 2));
  return usableCents(cents) ? cents : null;
}

export function availableToSell(orders: TradeOrder[], instrumentId: number): number {
  return cashAndShares(orders, instrumentId).availableShares;
}

export function cashAndShares(
  orders: TradeOrder[],
  instrumentId: number,
): { availableCashCents: bigint; availableShares: number } {
  const { cashCents, reservedBuyCents, books } = settle(orders);
  const book = books.get(instrumentId);
  return {
    availableCashCents: cashCents - reservedBuyCents,
    availableShares: book ? Math.max(0, book.qty - book.sellReserved) : 0,
  };
}

function settle(orders: TradeOrder[]): Settled {
  const books = new Map<number, Book>();
  let cashCents = 0n;
  let reservedBuyCents = 0n;

  for (const order of orders) {
    const notional = BigInt(order.size) * BigInt(order.priceCents);
    const status = order.status.toUpperCase();
    const side = order.side.toUpperCase();
    const type = order.type.toUpperCase();

    if (status === 'FILLED') {
      if (side === 'CASH_IN') cashCents += notional;
      else if (side === 'CASH_OUT') cashCents -= notional;
      else if (side === 'BUY') {
        cashCents -= notional;
        applyBuy(bookOf(books, order.instrumentId), order);
      } else if (side === 'SELL') {
        cashCents += notional;
        applySell(bookOf(books, order.instrumentId), order);
      }
    } else if (status === 'NEW' && type === 'LIMIT') {
      if (side === 'BUY') reservedBuyCents += notional;
      else if (side === 'SELL') bookOf(books, order.instrumentId).sellReserved += order.size;
    }
  }

  return { cashCents, reservedBuyCents, books };
}

function applyBuy(book: Book, order: TradeOrder): void {
  if (book.qty < 0) {
    const next = book.qty + order.size;
    book.qty = next;
    if (next > 0) {
      book.avgNum = BigInt(order.priceCents);
      book.avgDen = 1n;
    }
    return;
  }

  const next = book.qty + order.size;
  if (book.qty === 0) {
    book.avgNum = BigInt(order.priceCents);
    book.avgDen = 1n;
  } else {
    const avgNum = book.avgNum * BigInt(book.qty) + BigInt(order.priceCents) * BigInt(order.size) * book.avgDen;
    const avgDen = book.avgDen * BigInt(next);
    const divisor = gcd(avgNum, avgDen);
    book.avgNum = avgNum / divisor;
    book.avgDen = avgDen / divisor;
  }
  book.qty = next;
}

function applySell(book: Book, order: TradeOrder): void {
  book.qty -= order.size;
  if (book.qty <= 0) {
    book.avgNum = 0n;
    book.avgDen = 1n;
  }
}

function bookOf(books: Map<number, Book>, instrumentId: number): Book {
  const existing = books.get(instrumentId);
  if (existing) return existing;
  const created: Book = { qty: 0, avgNum: 0n, avgDen: 1n, sellReserved: 0 };
  books.set(instrumentId, created);
  return created;
}

function usableCents(cents: number | null): cents is number {
  return cents !== null && Number.isFinite(cents) && cents > 0;
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

function gcd(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a === 0n ? 1n : a;
}
