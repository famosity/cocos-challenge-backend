import { BadRequestException } from '@nestjs/common';
import { parseOrder } from '../orders/orders.parse.js';

const valid = {
  userId: 3,
  instrumentId: 10,
  side: 'BUY',
  type: 'MARKET',
  amount: '950.00',
};

describe('parseOrder', () => {
  it('reads a market order paid by amount', () => {
    expect(parseOrder(valid)).toEqual({
      userId: 3,
      instrumentId: 10,
      side: 'BUY',
      type: 'MARKET',
      amountCents: 95_000n,
    });
  });

  it('reads a limit order for a whole number of shares', () => {
    expect(parseOrder({ ...valid, type: 'LIMIT', quantity: 5, amount: undefined, price: '100.00' })).toEqual({
      userId: 3,
      instrumentId: 10,
      side: 'BUY',
      type: 'LIMIT',
      quantity: 5,
      priceCents: 10_000,
    });
  });

  it('rejects a body that mixes quantity and amount, or sends neither', () => {
    expect(() => parseOrder({ ...valid, quantity: 5 })).toThrow(BadRequestException);
    expect(() => parseOrder({ ...valid, amount: undefined })).toThrow(BadRequestException);
  });

  it('rejects a price on a market order and a limit order without one', () => {
    expect(() => parseOrder({ ...valid, price: '100.00' })).toThrow(BadRequestException);
    expect(() => parseOrder({ ...valid, type: 'LIMIT', amount: undefined, quantity: 1 })).toThrow(BadRequestException);
  });

  it('accepts the largest limit price and rejects the next cent', () => {
    const limit = { ...valid, type: 'LIMIT', amount: undefined, quantity: 1 };

    expect(parseOrder({ ...limit, price: '99999999.99' }).priceCents).toBe(9_999_999_999);
    expect(() => parseOrder({ ...limit, price: '100000000.00' })).toThrow(BadRequestException);
    try {
      parseOrder({ ...limit, price: '100000000.00' });
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        message: ['price must be at most 99999999.99'],
      });
    }
  });

  it('rejects amounts that are not positive decimals with at most two places', () => {
    expect(parseOrder({ ...valid, amount: '10' }).amountCents).toBe(1_000n);
    expect(parseOrder({ ...valid, amount: '10.5' }).amountCents).toBe(1_050n);
    for (const amount of ['0', '0.00', '-1.00', '10.555', 10]) {
      expect(() => parseOrder({ ...valid, amount })).toThrow(BadRequestException);
    }
  });
});
