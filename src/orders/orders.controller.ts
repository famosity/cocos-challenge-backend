import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { parseIdempotencyKey } from './orders.idempotency.js';
import { parseOrder } from './orders.parse.js';
import { OrdersService, type PlacedOrder } from './orders.service.js';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @HttpCode(201)
  place(@Req() request: Request, @Body() body: unknown): Promise<PlacedOrder> {
    const order = parseOrder(body);
    return this.orders.place(order, parseIdempotencyKey(request.rawHeaders));
  }
}
