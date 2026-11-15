import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { buildPortfolio, usableCloseCents, type Portfolio, type Quote, type TradeOrder } from './portfolio.calc.js';
import { PortfolioRepository, type OrderRow, type QuoteRow } from './portfolio.repository.js';

@Injectable()
export class PortfolioService {
  constructor(private readonly portfolio: PortfolioRepository) {}

  async get(userId: number): Promise<Portfolio> {
    const exists = await this.portfolio.exists(userId);
    if (!exists) {
      throw new AppError(404, 'USER_NOT_FOUND', 'El usuario no existe');
    }

    const orders = await this.portfolio.findOrders(userId);
    const instrumentIds = [
      ...new Set(
        orders
          .filter((order) => order.side === 'BUY' || order.side === 'SELL')
          .map((order) => order.instrumentId),
      ),
    ];
    const quotes = instrumentIds.length === 0 ? [] : await this.portfolio.findQuotes(instrumentIds);
    return buildPortfolio(orders.map(toTrade), quotes.map(toQuote));
  }
}

function toTrade(order: OrderRow): TradeOrder {
  return {
    instrumentId: order.instrumentId,
    size: order.size,
    priceCents: toCents(order.price),
    type: order.type,
    side: order.side,
    status: order.status,
  };
}

function toQuote(quote: QuoteRow): Quote {
  return {
    instrumentId: quote.instrumentId,
    ticker: quote.ticker,
    closeCents: usableCloseCents(quote.close),
  };
}

function toCents(price: string): number {
  const negative = price.startsWith('-');
  const [whole, fraction = ''] = price.replace('-', '').split('.');
  const cents = Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
  return negative ? -cents : cents;
}
