import { Injectable } from '@nestjs/common';
import { InstrumentsRepository, type InstrumentRow } from './instruments.repository.js';

export type InstrumentPage = {
  items: InstrumentRow[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
};

@Injectable()
export class InstrumentsService {
  constructor(private readonly instruments: InstrumentsRepository) {}

  async list(page: number, pageSize: number): Promise<InstrumentPage> {
    const offset = (BigInt(page) - 1n) * BigInt(pageSize);
    const { items, totalItems: count } = await this.instruments.list(pageSize, offset.toString());
    const totalItems = Number(count);
    return { items, pagination: { page, pageSize, totalItems, totalPages: Math.ceil(totalItems / pageSize) } };
  }

  search(term: string): Promise<InstrumentRow[]> {
    return this.instruments.search(term);
  }
}
