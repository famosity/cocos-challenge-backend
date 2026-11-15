export type TradeOrder = {
  instrumentId: number;
  size: number;
  priceCents: number;
  type: string;
  side: string;
  status: string;
};

export type HistoryRow = {
  instrumentId: number | null;
  size: number | null;
  price: string | null;
  type: string | null;
  side: string | null;
  status: string | null;
};

export type AccountBook = {
  qty: number;
  avgNum: bigint;
  avgDen: bigint;
  sellReserved: number;
};

export type SettledAccount = {
  cashCents: bigint;
  reservedBuyCents: bigint;
  books: Map<number, AccountBook>;
};

export function historyTrades(rows: HistoryRow[]): TradeOrder[] {
  const trades: TradeOrder[] = [];
  for (const row of rows) {
    const status = upper(row.status);
    const side = upper(row.side);
    const type = upper(row.type);
    const filled = status === 'FILLED' && (side === 'BUY' || side === 'SELL' || side === 'CASH_IN' || side === 'CASH_OUT');
    const reserved = status === 'NEW' && type === 'LIMIT' && (side === 'BUY' || side === 'SELL');
    if (!filled && !reserved) continue;

    const size = row.size;
    if (typeof size !== 'number' || !Number.isInteger(size)) throw new Error('order history is missing size');
    const instrumentId = row.instrumentId;
    if ((side === 'BUY' || side === 'SELL') && (typeof instrumentId !== 'number' || !Number.isInteger(instrumentId))) {
      throw new Error('order history is missing instrument');
    }

    const needsPrice = filled || side === 'BUY';
    const priceCents = row.price === null ? null : centsOf(row.price);
    if (priceCents === null && needsPrice) throw new Error('order history is missing price');
    if (row.price !== null && priceCents === null) throw new Error('order history is missing price');

    trades.push({
      instrumentId: instrumentId ?? 0,
      size,
      priceCents: priceCents ?? 0,
      type,
      side,
      status,
    });
  }
  return trades;
}

export function availableToSell(orders: TradeOrder[], instrumentId: number): number {
  return cashAndShares(orders, instrumentId).availableShares;
}

export function cashAndShares(
  orders: TradeOrder[],
  instrumentId: number,
): { availableCashCents: bigint; availableShares: number } {
  const { cashCents, reservedBuyCents, books } = settleAccount(orders);
  const book = books.get(instrumentId);
  return {
    availableCashCents: cashCents - reservedBuyCents,
    availableShares: book ? Math.max(0, book.qty - book.sellReserved) : 0,
  };
}

export function settleAccount(orders: TradeOrder[]): SettledAccount {
  const books = new Map<number, AccountBook>();
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

function applyBuy(book: AccountBook, order: TradeOrder): void {
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

function applySell(book: AccountBook, order: TradeOrder): void {
  book.qty -= order.size;
  if (book.qty <= 0) {
    book.avgNum = 0n;
    book.avgDen = 1n;
  }
}

function bookOf(books: Map<number, AccountBook>, instrumentId: number): AccountBook {
  const existing = books.get(instrumentId);
  if (existing) return existing;
  const created: AccountBook = { qty: 0, avgNum: 0n, avgDen: 1n, sellReserved: 0 };
  books.set(instrumentId, created);
  return created;
}

function centsOf(price: string): number | null {
  const negative = price.startsWith('-');
  const match = /^(\d+)(?:\.(\d+))?$/.exec(negative ? price.slice(1) : price);
  if (!match?.[1]) return null;
  const cents = Number(match[1]) * 100 + Number(((match[2] ?? '') + '00').slice(0, 2));
  if (!Number.isFinite(cents)) return null;
  return negative ? -cents : cents;
}

function upper(value: string | null): string {
  return (value ?? '').toUpperCase();
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
