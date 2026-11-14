import { InstrumentsRepository, type InstrumentRow } from './instruments.repository.js';
export declare class InstrumentsService {
    private readonly instruments;
    constructor(instruments: InstrumentsRepository);
    search(term: string): Promise<InstrumentRow[]>;
}
