import { Controller, Get, Query } from '@nestjs/common';
import { validationError } from '../common/app-error.js';
import { InstrumentsService } from './instruments.service.js';
import type { InstrumentRow } from './instruments.repository.js';

@Controller('instruments')
export class InstrumentsController {
  constructor(private readonly instruments: InstrumentsService) {}

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
