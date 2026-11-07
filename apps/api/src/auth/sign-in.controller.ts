import { BadRequestException, Body, Controller, HttpCode, HttpException, HttpStatus, Inject, Post, Res } from '@nestjs/common';
import type { Clock } from '@kit';
import type { SignInRequest, SignInResponse } from '@contracts';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { PrismaService } from '../database/prisma.service';
import { Public } from './public.decorator';
import { PIN_HASHER, type PinHasher } from './pin-hasher';
import { signIn } from './sign-in';
import { CLOCK } from './clock.token';

const FIELDS = ['deviceId', 'phone', 'pin'];

// Whitelist at the border: exactly three strings, nothing else. A refusal never echoes the body.
function signInRequestOf(body: unknown): SignInRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException();
  }
  const keys = Object.keys(body).sort();
  const fields = body as Record<string, unknown>;
  if (keys.join() !== FIELDS.join() || FIELDS.some((field) => typeof fields[field] !== 'string')) {
    throw new BadRequestException();
  }
  return { phone: fields['phone'] as string, pin: fields['pin'] as string, deviceId: fields['deviceId'] as string };
}

@Public()
@Controller('auth')
export class SignInController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PIN_HASHER) private readonly hasher: PinHasher,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('sign-in')
  @HttpCode(HttpStatus.OK)
  async signIn(@Body() body: unknown, @Res({ passthrough: true }) response: { setHeader(name: string, value: string): unknown }): Promise<SignInResponse> {
    const result = await signIn(signInRequestOf(body), { prisma: this.prisma, hasher: this.hasher, clock: this.clock, jwtSecret: this.config.jwtSecret });
    if (result.ok) {
      return result.value;
    }
    const refusal = result.error;
    switch (refusal.kind) {
      case 'InvalidRequest':
        throw new BadRequestException();
      case 'InvalidCredentials':
        throw new HttpException({ kind: refusal.kind }, HttpStatus.UNAUTHORIZED);
      case 'AccountBlocked':
        throw new HttpException({ kind: refusal.kind }, HttpStatus.FORBIDDEN);
      case 'TooManyAttempts':
        response.setHeader('Retry-After', String(Math.max(1, Math.ceil((Date.parse(refusal.retryAt) - this.clock.now().getTime()) / 1_000))));
        throw new HttpException(refusal, HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}
