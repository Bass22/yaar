import { Module } from '@nestjs/common';
import type { Clock } from '@kit';
import { Argon2PinHasher } from './argon2-pin-hasher';
import { CLOCK } from './clock.token';
import { PIN_HASHER } from './pin-hasher';
import { SignInController } from './sign-in.controller';

export { CLOCK } from './clock.token';

const systemClock: Clock = { now: () => new Date() };

@Module({
  controllers: [SignInController],
  providers: [
    { provide: PIN_HASHER, useClass: Argon2PinHasher },
    { provide: CLOCK, useValue: systemClock },
  ],
})
export class AuthModule {}
