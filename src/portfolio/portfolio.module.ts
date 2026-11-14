import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { PortfolioController } from './portfolio.controller.js';
import { PortfolioRepository } from './portfolio.repository.js';
import { PortfolioService } from './portfolio.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [PortfolioController],
  providers: [PortfolioService, PortfolioRepository],
  exports: [PortfolioService],
})
export class PortfolioModule {}