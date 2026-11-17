import { AppError } from '../common/app-error.js';
import { parseOrder } from './orders.parse.js';
import { orderFingerprint, parseIdempotencyKey, sameOrderFingerprint } from './orders.idempotency.js';

const market = {
  userId: 2,
  instrumentId: 10,
  side: 'BUY',
  type: 'MARKET',
  amount: '800.00',
};

describe('parseIdempotencyKey', () => {
  it('returns undefined when the header is absent', () => {
    expect(parseIdempotencyKey(['Content-Type', 'application/json'])).toBeUndefined();
  });

  it('keeps the original characters of one header', () => {
    expect(parseIdempotencyKey(['Idempotency-Key', 'Buy.Order-1'])).toBe('Buy.Order-1');
    expect(parseIdempotencyKey(['IDEMPOTENCY-KEY', 'a'.repeat(128)])).toBe('a'.repeat(128));
  });

  it('rejects an empty, repeated, or malformed header', () => {
    expect(detailsOf(['Idempotency-Key', ''])).toEqual([{ field: 'Idempotency-Key', message: 'must not be empty' }]);
    expect(detailsOf(['Idempotency-Key', 'abc', 'Idempotency-Key', 'ABC'])).toEqual([
      { field: 'Idempotency-Key', message: 'must be sent once' },
    ]);
    expect(detailsOf(['Idempotency-Key', 'a'.repeat(129)])).toEqual([
      {
        field: 'Idempotency-Key',
        message: 'must be 1 to 128 letters, digits, dots, hyphens or underscores',
      },
    ]);
    expect(detailsOf(['Idempotency-Key', 'has space'])).toEqual([
      {
        field: 'Idempotency-Key',
        message: 'must be 1 to 128 letters, digits, dots, hyphens or underscores',
      },
    ]);
  });
});

describe('orderFingerprint', () => {
  it('treats equivalent cent amounts as the same request and quantity as a different one', () => {
    const short = orderFingerprint(parseOrder({ ...market, amount: '800.0' }));
    const padded = orderFingerprint(parseOrder({ ...market, amount: '800.00' }));
    const shares = orderFingerprint(parseOrder({ ...market, amount: undefined, quantity: 8 }));

    expect(sameOrderFingerprint(short, padded)).toBe(true);
    expect(sameOrderFingerprint(short, shares)).toBe(false);
    expect(short.amountCents).toBe('80000');
    expect(shares.quantity).toBe(8);
    expect(shares.amountCents).toBeNull();
  });
});

function detailsOf(rawHeaders: string[]): AppError['details'] {
  try {
    parseIdempotencyKey(rawHeaders);
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    return (error as AppError).details;
  }
  throw new Error('expected a validation error');
}
