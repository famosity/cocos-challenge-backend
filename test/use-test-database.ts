import { loadEnvFile } from '../src/load-env.js';

export function useTestDatabase(): string {
  loadEnvFile();
  return applyTestDatabase(process.env);
}

export function applyTestDatabase(env: NodeJS.ProcessEnv): string {
  const url = env.TEST_DATABASE_URL?.trim();
  if (!url) throw new Error('TEST_DATABASE_URL is not set');
  env.DATABASE_URL = url;
  return url;
}
