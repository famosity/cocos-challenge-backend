import { Controller, Get, Query } from '@nestjs/common';
import { validationError } from '../common/app-error.js';
import { InstrumentsService, type InstrumentPage } from './instruments.service.js';
import type { InstrumentRow } from './instruments.repository.js';

@Controller('instruments')
export class InstrumentsController {
  constructor(private readonly instruments: InstrumentsService) {}

  @Get('all')
  list(@Query('page') page?: unknown, @Query('pageSize') pageSize?: unknown): Promise<InstrumentPage> {
    return this.instruments.list(
      paginationInteger(page, 'page', 1, Number.MAX_SAFE_INTEGER),
      paginationInteger(pageSize, 'pageSize', 20, 100),
    );
  }

  @Get()
  search(@Query('query') query?: string | string[]): Promise<InstrumentRow[]> {
    if (typeof query !== 'string') {
      throw validationError('query', query === undefined ? 'must not be empty' : 'must be a single text');
    }
    if (query.includes('\0')) {
      throw validationError('query', 'must not contain a null character');
    }
    const term = query.trim();
    if (term.length === 0) {
      throw validationError('query', 'must not be empty');
    }
    return this.instruments.search(term);
  }
}

function paginationInteger(value: unknown, field: string, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.length === 0 || /[^0-9]/.test(value)) {
    throw validationError(field, 'must be a positive integer');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw validationError(field, `must be between 1 and ${max}`);
  }
  return parsed;
}
