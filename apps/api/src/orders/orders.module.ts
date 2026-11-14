import { ReceptionsController } from './receptions.controller';
import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';

@Module({
  controllers: [OrdersController, ReceptionsController],
})
export class OrdersModule {}
