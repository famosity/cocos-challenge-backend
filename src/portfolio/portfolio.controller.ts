import { Controller, Get, Param } from '@nestjs/common';
import { validationError } from '../common/app-error.js';
import { PG_INT4_MAX } from '../database/postgres-limits.js';
import { PortfolioService } from './portfolio.service.js';
import type { Portfolio } from './portfolio.calc.js';

const userIdPattern = /^[1-9]\d*$/;

@Controller('users')
export class PortfolioController {
  constructor(private readonly portfolio: PortfolioService) {}

  @Get(':userId/portfolio')
  get(@Param('userId') userId: string): Promise<Portfolio> {
    if (!userIdPattern.test(userId) || BigInt(userId) > PG_INT4_MAX) {
      throw validationError('userId', 'must be a positive integer');
    }
    return this.portfolio.get(Number(userId));
  }
}
