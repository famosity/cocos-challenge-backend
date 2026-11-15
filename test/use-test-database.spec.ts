import { applyTestDatabase } from './use-test-database.js';

describe('applyTestDatabase', () => {
  it('stops before any connection when the test url is empty', () => {
    const env = { DATABASE_URL: 'postgresql://app.example/cocos', TEST_DATABASE_URL: '' };

    expect(() => applyTestDatabase(env)).toThrow('TEST_DATABASE_URL is not set');
    expect(env.DATABASE_URL).toBe('postgresql://app.example/cocos');
  });

  it('stops before any connection when only the application url is set', () => {
    const env = { DATABASE_URL: 'postgresql://app.example/cocos' };

    expect(() => applyTestDatabase(env)).toThrow('TEST_DATABASE_URL is not set');
    expect(env.DATABASE_URL).toBe('postgresql://app.example/cocos');
  });

  it('points the application connection at the explicit test url', () => {
    const env = {
      DATABASE_URL: 'postgresql://app.example/cocos',
      TEST_DATABASE_URL: 'postgresql://test.example/cocos',
    };

    expect(applyTestDatabase(env)).toBe('postgresql://test.example/cocos');
    expect(env.DATABASE_URL).toBe('postgresql://test.example/cocos');
  });
});
