import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { parseOrder } from './orders.parse.js';
import { OrdersService, type PlacedOrder } from './orders.service.js';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @HttpCode(201)
  place(@Body() body: unknown): Promise<PlacedOrder> {
    return this.orders.place(parseOrder(body));
  }
}
