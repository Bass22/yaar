import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { ClosedByDefaultGuard } from './auth/closed-by-default.guard';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [ConfigModule, DatabaseModule, AuthModule],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ClosedByDefaultGuard }],
})
export class AppModule {}
