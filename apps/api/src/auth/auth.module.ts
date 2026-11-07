import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import type { Clock } from '@kit';
import { Argon2PinHasher } from './argon2-pin-hasher';
import { CLOCK } from './clock.token';
import { PIN_HASHER } from './pin-hasher';
import { SessionGuard } from './session.guard';
import { SignInController } from './sign-in.controller';
import { TenantTransactionInterceptor } from './tenant-transaction.interceptor';

export { CLOCK } from './clock.token';

const systemClock: Clock = { now: () => new Date() };

@Module({
  controllers: [SignInController],
  providers: [
    { provide: PIN_HASHER, useClass: Argon2PinHasher },
    { provide: CLOCK, useValue: systemClock },
    // Every route is closed unless @Public() opens it; every request with a session runs in
    // one transaction of its tenant, after its account was read again.
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantTransactionInterceptor },
  ],
})
export class AuthModule {}
