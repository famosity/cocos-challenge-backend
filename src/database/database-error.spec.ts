import { AppError } from '../common/app-error.js';
import { databaseError, isConnectionFailure } from './database-error.js';

describe('database errors', () => {
  it.each(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', '08006', '57P01'])(
    'discards broken connections with code %s and returns a public 503',
    (code) => {
      const error = Object.assign(new Error('private connection details'), { code });
      expect(isConnectionFailure(error)).toBe(true);
      expect(databaseError(error)).toMatchObject({ statusCode: 503, code: 'DATABASE_UNAVAILABLE', cause: error });
      expect((databaseError(error) as Error).message).not.toContain('private');
    },
  );

  it.each(['57014', '55P03', '53300'])('maps server resource errors %s without treating them as broken sockets', (code) => {
    const error = Object.assign(new Error('server error'), { code });
    expect(isConnectionFailure(error)).toBe(false);
    expect(databaseError(error)).toMatchObject({ statusCode: 503, code: 'DATABASE_UNAVAILABLE' });
  });

  it('recognizes the driver read timeout without a SQLSTATE', () => {
    const error = new Error('Query read timeout');
    expect(isConnectionFailure(error)).toBe(true);
    expect(databaseError(error)).toMatchObject({ statusCode: 503 });
  });

  it('preserves domain errors and unexpected SQL errors', () => {
    const domain = new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'Conflict');
    const sql = Object.assign(new Error('syntax error'), { code: '42601' });
    expect(databaseError(domain)).toBe(domain);
    expect(databaseError(sql)).toBe(sql);
    expect(databaseError(null)).toBeNull();
  });
});
