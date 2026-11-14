import { InstrumentsService } from './instruments.service.js';
import type { InstrumentRow } from './instruments.repository.js';
export declare class InstrumentsController {
    private readonly instruments;
    constructor(instruments: InstrumentsService);
    search(query?: string): Promise<InstrumentRow[]>;
}
