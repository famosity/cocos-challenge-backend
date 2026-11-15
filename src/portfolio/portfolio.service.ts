import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { buildPortfolio, historyTrades, usableCloseCents, type Portfolio, type Quote } from './portfolio.calc.js';
import { PortfolioRepository, type QuoteRow } from './portfolio.repository.js';

@Injectable()
export class PortfolioService {
  constructor(private readonly portfolio: PortfolioRepository) {}

  async get(userId: number): Promise<Portfolio> {
    const exists = await this.portfolio.exists(userId);
    if (!exists) {
      throw new AppError(404, 'USER_NOT_FOUND', 'El usuario no existe');
    }

    const trades = historyTrades(await this.portfolio.findOrders(userId));
    const instrumentIds = [
      ...new Set(
        trades.filter((order) => order.side === 'BUY' || order.side === 'SELL').map((order) => order.instrumentId),
      ),
    ];
    const quotes = instrumentIds.length === 0 ? [] : await this.portfolio.findQuotes(instrumentIds);
    return buildPortfolio(trades, quotes.map(toQuote));
  }
}

function toQuote(quote: QuoteRow): Quote {
  return {
    instrumentId: quote.instrumentId,
    ticker: quote.ticker,
    closeCents: usableCloseCents(quote.close),
  };
}

