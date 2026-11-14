import { SaleForecastsController } from './sale-forecasts.controller';
import { Module } from '@nestjs/common';
import { SalesController } from './sales.controller';

@Module({
  controllers: [SalesController, SaleForecastsController],
})
export class SalesModule {}
