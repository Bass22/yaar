import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { CounterpartiesModule } from './counterparties/counterparties.module';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { JournalModule } from './journal/journal.module';
import { CostsModule } from './costs/costs.module';
import { LedgerModule } from './ledger/ledger.module';
import { MediaModule } from './media/media.module';
import { SalesModule } from './sales/sales.module';
import { WeighingsModule } from './weighings/weighings.module';
import { OrdersModule } from './orders/orders.module';
import { ReferenceDataModule } from './reference-data/reference-data.module';
import { SitesModule } from './sites/sites.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [ConfigModule, DatabaseModule, AuthModule, UsersModule, SitesModule, CampaignsModule, CostsModule, CounterpartiesModule, JournalModule, LedgerModule, MediaModule, OrdersModule, ReferenceDataModule, SalesModule, WeighingsModule],
  controllers: [HealthController],
})
export class AppModule {}
