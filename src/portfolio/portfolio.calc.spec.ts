import { availableToSell, buildPortfolio, usableCloseCents, type TradeOrder } from '../portfolio/portfolio.calc.js';

const cash = (size: number, priceCents = 100): TradeOrder => ({
  instrumentId: 66,
  size,
  priceCents,
  type: 'MARKET',
  side: 'CASH_IN',
  status: 'FILLED',
});

describe('buildPortfolio', () => {
  it('returns zero cash and no positions when the user has no orders', () => {
    expect(buildPortfolio([], [])).toEqual({
      totalValue: '0.00',
      availableCash: '0.00',
      positions: [],
    });
  });

  it('keeps a limit buy in new as a cash reserve and out of the total', () => {
    const portfolio = buildPortfolio(
      [cash(1000), buy(5, 10_000, 'NEW', 'LIMIT')],
      [quote(10, 'PAMP', 10_000)],
    );

    expect(portfolio.availableCash).toBe('500.00');
    expect(portfolio.totalValue).toBe('1000.00');
    expect(portfolio.positions).toEqual([]);
  });

  it('counts a filled buy once, as shares and as cash spent', () => {
    const portfolio = buildPortfolio(
      [cash(1000), buy(5, 10_000, 'FILLED', 'LIMIT')],
      [quote(10, 'PAMP', 10_000)],
    );

    expect(portfolio.availableCash).toBe('500.00');
    expect(portfolio.totalValue).toBe('1000.00');
    expect(portfolio.positions).toEqual([
      {
        instrumentId: 10,
        ticker: 'PAMP',
        quantity: 5,
        marketValue: '500.00',
        totalReturnPct: 0,
      },
    ]);
  });

  it('ignores cancelled and rejected orders', () => {
    const portfolio = buildPortfolio(
      [
        cash(1000),
        buy(5, 10_000, 'CANCELLED', 'LIMIT'),
        buy(5, 10_000, 'REJECTED', 'MARKET'),
      ],
      [quote(10, 'PAMP', 10_000)],
    );

    expect(portfolio).toEqual({
      totalValue: '1000.00',
      availableCash: '1000.00',
      positions: [],
    });
  });

  it('values a short of 10 at the close and leaves the return empty', () => {
    const portfolio = buildPortfolio(
      [cash(4000), sell(10, 10_000, 'FILLED', 'MARKET')],
      [quote(10, 'PAMP', 10_000)],
    );

    expect(portfolio.availableCash).toBe('5000.00');
    expect(portfolio.totalValue).toBe('4000.00');
    expect(portfolio.positions).toEqual([
      {
        instrumentId: 10,
        ticker: 'PAMP',
        quantity: -10,
        marketValue: '-1000.00',
        totalReturnPct: null,
      },
    ]);
  });

  it('gives the crossing buy price to the shares that remain open', () => {
    const portfolio = buildPortfolio(
      [
        cash(4000),
        sell(10, 8_000, 'FILLED', 'MARKET'),
        buy(15, 10_000, 'FILLED', 'MARKET'),
      ],
      [quote(10, 'PAMP', 12_000)],
    );

    expect(portfolio.positions[0]).toMatchObject({
      quantity: 5,
      marketValue: '600.00',
      totalReturnPct: 20,
    });
  });

  it('keeps a short when the buy does not cover it', () => {
    const portfolio = buildPortfolio(
      [sell(10, 10_000, 'FILLED', 'MARKET'), buy(6, 10_000, 'FILLED', 'MARKET')],
      [quote(10, 'PAMP', 10_000)],
    );

    expect(portfolio.positions[0]).toMatchObject({
      quantity: -4,
      marketValue: '-400.00',
      totalReturnPct: null,
    });
  });

  it('drops the cost after the position goes back to zero', () => {
    const portfolio = buildPortfolio(
      [
        buy(10, 5_000, 'FILLED', 'MARKET'),
        sell(10, 5_000, 'FILLED', 'MARKET'),
        buy(4, 8_000, 'FILLED', 'MARKET'),
      ],
      [quote(10, 'PAMP', 10_000)],
    );

    expect(portfolio.positions[0]).toMatchObject({ quantity: 4, totalReturnPct: 25 });
  });

  it('keeps the average cost after a partial sale', () => {
    const portfolio = buildPortfolio(
      [
        buy(10, 10_000, 'FILLED', 'MARKET'),
        buy(10, 20_000, 'FILLED', 'MARKET'),
        sell(5, 15_000, 'FILLED', 'MARKET'),
      ],
      [quote(10, 'PAMP', 18_000)],
    );

    expect(portfolio.positions[0]).toMatchObject({ quantity: 15, totalReturnPct: 20 });
  });

  it('rounds the return half away from zero', () => {
    const portfolio = buildPortfolio([buy(40, 93_000, 'FILLED', 'MARKET')], [quote(10, 'PAMP', 92_585)]);

    expect(portfolio.positions[0]?.totalReturnPct).toBe(-0.45);
  });

  it('rounds a return that lands on a half cent', () => {
    const portfolio = buildPortfolio([buy(1, 200_000, 'FILLED', 'MARKET')], [quote(10, 'PAMP', 200_010)]);

    expect(portfolio.positions[0]?.totalReturnPct).toBe(0.01);
  });

  it('leaves the position value and the total empty when the close is zero or negative', () => {
    const orders = [cash(1000), buy(4, 10_000, 'FILLED', 'MARKET')];

    for (const closeCents of [0, -100, Number.NaN]) {
      const portfolio = buildPortfolio(orders, [quote(10, 'PAMP', closeCents)]);

      expect(portfolio.availableCash).toBe('600.00');
      expect(portfolio.totalValue).toBeNull();
      expect(portfolio.positions[0]).toMatchObject({ quantity: 4, marketValue: null, totalReturnPct: null });
    }
  });

  it('leaves the position value and the total empty when the close is missing', () => {
    const portfolio = buildPortfolio(
      [cash(1000), buy(1, 10_000, 'FILLED', 'MARKET'), buy(2, 5_000, 'FILLED', 'MARKET', 11)],
      [quote(10, 'PAMP', null), quote(11, 'METR', 8_000)],
    );

    expect(portfolio.availableCash).toBe('800.00');
    expect(portfolio.totalValue).toBeNull();
    expect(portfolio.positions).toEqual([
      {
        instrumentId: 11,
        ticker: 'METR',
        quantity: 2,
        marketValue: '160.00',
        totalReturnPct: 60,
      },
      {
        instrumentId: 10,
        ticker: 'PAMP',
        quantity: 1,
        marketValue: null,
        totalReturnPct: null,
      },
    ]);
  });

  it('uses integer cents for a price that is not a whole peso', () => {
    const portfolio = buildPortfolio([cash(1000), buy(3, 1_001, 'FILLED', 'MARKET')], [quote(10, 'PAMP', 1_001)]);

    expect(portfolio.availableCash).toBe('969.97');
    expect(portfolio.positions[0]?.marketValue).toBe('30.03');
  });
});

describe('usableCloseCents', () => {
  it('keeps a positive close and drops a missing, zero, negative or non numeric one', () => {
    expect(usableCloseCents('100.50')).toBe(10_050);
    expect(usableCloseCents('100')).toBe(10_000);
    expect(usableCloseCents(null)).toBeNull();
    expect(usableCloseCents('0.00')).toBeNull();
    expect(usableCloseCents('-1.50')).toBeNull();
    expect(usableCloseCents('NaN')).toBeNull();
    expect(usableCloseCents('Infinity')).toBeNull();
  });
});

describe('availableToSell', () => {
  it('subtracts a new limit sale from the holding and floors at zero', () => {
    const held = [buy(10, 10_000, 'FILLED', 'MARKET'), sell(4, 10_000, 'NEW', 'LIMIT')];

    expect(availableToSell(held, 10)).toBe(6);
    expect(availableToSell([...held, sell(12, 10_000, 'NEW', 'LIMIT')], 10)).toBe(0);
  });

  it('ignores a cancelled sale', () => {
    const orders = [buy(10, 10_000, 'FILLED', 'MARKET'), sell(4, 10_000, 'CANCELLED', 'LIMIT')];

    expect(availableToSell(orders, 10)).toBe(10);
  });
});

function buy(size: number, priceCents: number, status: string, type: string, instrumentId = 10): TradeOrder {
  return { instrumentId, size, priceCents, type, side: 'BUY', status };
}

function sell(size: number, priceCents: number, status: string, type: string, instrumentId = 10): TradeOrder {
  return { instrumentId, size, priceCents, type, side: 'SELL', status };
}

function quote(instrumentId: number, ticker: string, closeCents: number | null) {
  return { instrumentId, ticker, closeCents };
}
