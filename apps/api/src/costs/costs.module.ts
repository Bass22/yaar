import { Module } from '@nestjs/common';
import { CostsController } from './costs.controller';

@Module({
  controllers: [CostsController],
})
export class CostsModule {}
