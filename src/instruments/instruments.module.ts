import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { InstrumentsController } from './instruments.controller.js';
import { InstrumentsRepository } from './instruments.repository.js';
import { InstrumentsService } from './instruments.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [InstrumentsController],
  providers: [InstrumentsService, InstrumentsRepository],
  exports: [InstrumentsService],
})
export class InstrumentsModule {}