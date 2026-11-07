import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { SitesModule } from './sites/sites.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [ConfigModule, DatabaseModule, AuthModule, UsersModule, SitesModule],
  controllers: [HealthController],
})
export class AppModule {}
