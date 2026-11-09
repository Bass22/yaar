import { Module } from '@nestjs/common';
import { CostTypesController } from './cost-types.controller';
import { ReferenceDataController } from './reference-data.controller';

@Module({
  controllers: [ReferenceDataController, CostTypesController],
})
export class ReferenceDataModule {}
