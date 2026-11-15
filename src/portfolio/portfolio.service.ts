import { Injectable } from '@nestjs/common';
import { historyTrades } from '../account/account-availability.js';
import { usableCloseCents } from '../account/usable-close.js';
import { userNotFound } from '../common/app-error.js';
import { buildPortfolio, type Portfolio, type Quote } from './portfolio.calc.js';
import { PortfolioRepository, type QuoteRow } from './portfolio.repository.js';

@Injectable()
export class PortfolioService {
  constructor(private readonly portfolio: PortfolioRepository) {}

  async get(userId: number): Promise<Portfolio> {
    const exists = await this.portfolio.exists(userId);
    if (!exists) {
      throw userNotFound();
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

