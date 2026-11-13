import { Module } from '@nestjs/common';
import { InstrumentsService } from './instruments.service.js';

@Module({
  providers: [InstrumentsService],
  exports: [InstrumentsService],
})
export class InstrumentsModule {}
