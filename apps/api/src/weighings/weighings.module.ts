import { Module } from '@nestjs/common';
import { WeighingsController } from './weighings.controller';

@Module({
  controllers: [WeighingsController],
})
export class WeighingsModule {}
