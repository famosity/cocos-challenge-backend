import { AppError } from '../common/app-error.js';

const connectionCodes = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  '57P01',
  '57P02',
  '57P03',
]);

const connectionMessages = new Set([
  'Query read timeout',
  'Connection terminated',
  'Connection terminated unexpectedly',
  'Connection terminated due to connection timeout',
  'timeout exceeded when trying to connect',
  'Client has encountered a connection error and is not queryable',
  'Client was closed and is not queryable',
]);

export function isConnectionFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = errorCode(error);
  return code.startsWith('08') || connectionCodes.has(code) || connectionMessages.has(error.message);
}

export function databaseError(error: unknown): unknown {
  if (error instanceof AppError) return error;
  const code = errorCode(error);
  if (isConnectionFailure(error) || code === '57014' || code === '55P03' || code === '53300') {
    const unavailable = new AppError(503, 'DATABASE_UNAVAILABLE', 'La base de datos no está disponible. Intentá nuevamente');
    unavailable.cause = error;
    return unavailable;
  }
  return error;
}

function errorCode(error: unknown): string {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') return error.code;
  return '';
}
