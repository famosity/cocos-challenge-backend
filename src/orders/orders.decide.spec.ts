import { decideOrder } from '../orders/orders.decide.js';

const cash = 100_000n;
const close = 10_000;

describe('decideOrder', () => {
  it('fills a market buy for the whole shares and ignores the unused remainder', () => {
    const decision = decideOrder(buy({ amountCents: 95_000n }), cash, 0, close);

    expect(decision).toEqual({ outcome: 'accept', status: 'FILLED', size: 9, priceCents: close });
  });

  it('rejects a market buy when the requested amount exceeds the cash, even if the rounded cost fits', () => {
    const decision = decideOrder(buy({ amountCents: 105_000n }), cash, 0, close);

    expect(decision).toEqual({
      outcome: 'reject',
      status: 'REJECTED',
      reason: 'INSUFFICIENT_FUNDS',
      size: 10,
      priceCents: close,
    });
  });

  it('stops before saving when the amount does not buy one share', () => {
    expect(decideOrder(buy({ amountCents: 8_000n }), cash, 0, close)).toEqual({
      outcome: 'unprocessable',
      code: 'ZERO_ORDER_QUANTITY',
    });
  });

  it('stops before saving a market order that has no close', () => {
    expect(decideOrder(buy({ quantity: 1 }), cash, 0, null)).toEqual({
      outcome: 'unprocessable',
      code: 'QUOTE_UNAVAILABLE',
    });
  });

  it('opens a limit buy as new and reserves the share cost', () => {
    const decision = decideOrder(buy({ quantity: 5, priceCents: close, type: 'LIMIT' }), cash, 0, null);

    expect(decision).toEqual({ outcome: 'accept', status: 'NEW', size: 5, priceCents: close });
  });

  it('rejects a buy whose cost is above the available cash', () => {
    const decision = decideOrder(buy({ quantity: 5, priceCents: close, type: 'LIMIT' }), 40_000n, 0, null);

    expect(decision).toMatchObject({ outcome: 'reject', reason: 'INSUFFICIENT_FUNDS', size: 5 });
  });

  it('fills a market sale for the shares under the amount cap', () => {
    const decision = decideOrder(sell({ amountCents: 95_000n }), 0n, 9, close);

    expect(decision).toEqual({ outcome: 'accept', status: 'FILLED', size: 9, priceCents: close });
  });

  it('opens a limit sale when the shares are available', () => {
    const decision = decideOrder(sell({ amountCents: 95_000n, type: 'LIMIT', priceCents: close }), 0n, 9, null);

    expect(decision).toEqual({ outcome: 'accept', status: 'NEW', size: 9, priceCents: close });
  });

  it('rejects a sale and keeps the calculated size when the shares are short', () => {
    const decision = decideOrder(sell({ amountCents: 95_000n }), 0n, 8, close);

    expect(decision).toEqual({
      outcome: 'reject',
      status: 'REJECTED',
      reason: 'INSUFFICIENT_SHARES',
      size: 9,
      priceCents: close,
    });
  });

  it('rejects a sale from a flat or short position', () => {
    expect(decideOrder(sell({ quantity: 1 }), 500_000n, 0, close)).toMatchObject({
      outcome: 'reject',
      reason: 'INSUFFICIENT_SHARES',
      size: 1,
    });
  });
});

function buy(overrides: Partial<Parameters<typeof decideOrder>[0]> = {}) {
  return { side: 'BUY' as const, type: 'MARKET' as const, ...overrides };
}

function sell(overrides: Partial<Parameters<typeof decideOrder>[0]> = {}) {
  return { side: 'SELL' as const, type: 'MARKET' as const, ...overrides };
}
