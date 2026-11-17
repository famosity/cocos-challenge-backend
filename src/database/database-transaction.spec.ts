import { DatabaseService } from './database.service.js';

const driver = vi.hoisted(() => ({ connect: vi.fn(), query: vi.fn(), on: vi.fn(), end: vi.fn() }));
vi.mock('pg', () => ({ Pool: class {
  connect = driver.connect;
  query = driver.query;
  on = driver.on;
  end = driver.end;
} }));

describe('transaction cleanup', () => {
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL', 'postgresql://localhost/test');
    vi.clearAllMocks();
  });

  afterEach(() => vi.unstubAllEnvs());

  function connection() {
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn(), on: vi.fn(), removeListener: vi.fn() };
    driver.connect.mockResolvedValue(client);
    return client;
  }

  it('returns 503 if acquiring a connection times out', async () => {
    driver.connect.mockRejectedValue(new Error('timeout exceeded when trying to connect'));
    const run = vi.fn();
    await expect(new DatabaseService().transaction(run)).rejects.toMatchObject({ statusCode: 503 });
    expect(run).not.toHaveBeenCalled();
  });

  it('rolls back a server timeout before returning the connection', async () => {
    const client = connection();
    const timeout = Object.assign(new Error('lock timeout'), { code: '55P03' });
    client.query.mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(timeout);
    await expect(new DatabaseService().transaction((query) => query('SELECT locked'))).rejects.toMatchObject({ statusCode: 503 });
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN ISOLATION LEVEL READ COMMITTED', 'SELECT locked', 'ROLLBACK']);
    expect(client.release).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('discards a read timeout without queueing a rollback behind the stuck query', async () => {
    const client = connection();
    client.query.mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(new Error('Query read timeout'));
    await expect(new DatabaseService().transaction((query) => query('SELECT stuck'))).rejects.toMatchObject({ statusCode: 503 });
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('discards the connection if rollback fails and preserves the original error', async () => {
    const client = connection();
    const error = new Error('domain failure');
    client.query.mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(new Error('Query read timeout'));
    await expect(new DatabaseService().transaction(() => Promise.reject(error))).rejects.toBe(error);
    expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('returns 503 after an uncertain commit and discards the connection without retrying', async () => {
    const client = connection();
    client.query.mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(new Error('Connection terminated unexpectedly'));
    const run = vi.fn().mockResolvedValue({ id: 123 });
    await expect(new DatabaseService().transaction(run)).rejects.toMatchObject({ statusCode: 503 });
    expect(run).toHaveBeenCalledTimes(1);
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN ISOLATION LEVEL READ COMMITTED', 'COMMIT']);
    expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
  });
});
