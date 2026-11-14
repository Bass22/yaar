import { Module } from '@nestjs/common';
import { CostTypesController } from './cost-types.controller';
import { PriceCatalogController } from './price-catalog.controller';
import { ReferenceDataController } from './reference-data.controller';

@Module({
  controllers: [ReferenceDataController, CostTypesController, PriceCatalogController],
})
export class ReferenceDataModule {}
