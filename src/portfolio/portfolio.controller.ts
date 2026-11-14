import { BadRequestException, Controller, Get, Param } from '@nestjs/common';
import { PortfolioService } from './portfolio.service.js';
import type { Portfolio } from './portfolio.calc.js';

const userIdPattern = /^[1-9]\d*$/;

@Controller('users')
export class PortfolioController {
  constructor(private readonly portfolio: PortfolioService) {}

  @Get(':userId/portfolio')
  get(@Param('userId') userId: string): Promise<Portfolio> {
    if (!userIdPattern.test(userId) || BigInt(userId) > 2147483647n) {
      throw new BadRequestException(['userId must be a positive integer']);
    }
    return this.portfolio.get(Number(userId));
  }
}
