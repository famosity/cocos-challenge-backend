export const databaseTimeouts = {
  connectionTimeoutMillis: 5_000,
  lock_timeout: 5_000,
  statement_timeout: 10_000,
  query_timeout: 15_000,
} as const;
