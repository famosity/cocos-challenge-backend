import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { InstrumentsService } from './instruments.service.js';
import type { InstrumentRow } from './instruments.repository.js';

@Controller('instruments')
export class InstrumentsController {
  constructor(private readonly instruments: InstrumentsService) {}

  @Get()
  search(@Query('query') query?: string): Promise<InstrumentRow[]> {
    const term = query?.trim() ?? '';
    if (term.length === 0) {
      throw new BadRequestException(['query must not be empty']);
    }
    return this.instruments.search(term);
  }
}
