import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ClosedByDefaultGuard } from './auth/closed-by-default.guard';
import { HealthController } from './health/health.controller';

@Module({
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ClosedByDefaultGuard }],
})
export class AppModule {}
