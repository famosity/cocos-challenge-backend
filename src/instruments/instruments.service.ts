import { Injectable } from '@nestjs/common';
import { InstrumentsRepository, type InstrumentRow } from './instruments.repository.js';

@Injectable()
export class InstrumentsService {
  constructor(private readonly instruments: InstrumentsRepository) {}

  search(term: string): Promise<InstrumentRow[]> {
    return this.instruments.search(term);
  }
}
