import { BadRequestException, Body, Controller, HttpCode, HttpException, HttpStatus, Inject, Post, Res } from '@nestjs/common';
import type { Clock } from '@kit';
import type { ChoosePinRefusal, ChoosePinRequest, SignInRequest, SignInResponse } from '@contracts';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { PrismaService } from '../database/prisma.service';
import { Public } from './public.decorator';
import { PIN_HASHER, type PinHasher } from './pin-hasher';
import { choosePin, signIn, UnknownNumberAttempts } from './sign-in';
import { CLOCK } from './clock.token';

// Whitelist at the border: exactly these fields, all strings, nothing else. A refusal never
// echoes the body.
function stringsOf(body: unknown, fields: readonly string[]): Record<string, string> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException();
  }
  const values = body as Record<string, unknown>;
  if (Object.keys(values).sort().join() !== [...fields].sort().join() || fields.some((field) => typeof values[field] !== 'string')) {
    throw new BadRequestException();
  }
  return values as Record<string, string>;
}

function signInRequestOf(body: unknown): SignInRequest {
  const { phone, pin, deviceId } = stringsOf(body, ['phone', 'pin', 'deviceId']);
  return { phone: phone ?? '', pin: pin ?? '', deviceId: deviceId ?? '' };
}

function choosePinRequestOf(body: unknown): ChoosePinRequest {
  const { phone, provisionalPin, newPin, deviceId } = stringsOf(body, ['phone', 'provisionalPin', 'newPin', 'deviceId']);
  return { phone: phone ?? '', provisionalPin: provisionalPin ?? '', newPin: newPin ?? '', deviceId: deviceId ?? '' };
}

@Public()
@Controller('auth')
export class SignInController {
  // One per instance of the API, for its life: the attempts on numbers without an account (R-16).
  private readonly unknownNumbers = new UnknownNumberAttempts();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PIN_HASHER) private readonly hasher: PinHasher,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('sign-in')
  @HttpCode(HttpStatus.OK)
  async signIn(@Body() body: unknown, @Res({ passthrough: true }) response: { setHeader(name: string, value: string): unknown }): Promise<SignInResponse> {
    const result = await signIn(signInRequestOf(body), this.deps());
    return this.answer(result, response);
  }

  @Post('choose-pin')
  @HttpCode(HttpStatus.OK)
  async choosePin(@Body() body: unknown, @Res({ passthrough: true }) response: { setHeader(name: string, value: string): unknown }): Promise<SignInResponse> {
    return this.answer(await choosePin(choosePinRequestOf(body), this.deps()), response);
  }

  private deps() {
    return { prisma: this.prisma, hasher: this.hasher, clock: this.clock, jwtSecret: this.config.jwtSecret, unknownNumbers: this.unknownNumbers };
  }

  private answer(
    result: { ok: true; value: SignInResponse } | { ok: false; error: ChoosePinRefusal },
    response: { setHeader(name: string, value: string): unknown },
  ): SignInResponse {
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
      case 'PinMustBeChosen':
      case 'ProvisionalPinExpired':
        throw new HttpException({ kind: refusal.kind }, HttpStatus.FORBIDDEN);
      case 'PinAlreadyChosen':
        throw new HttpException(refusal, HttpStatus.CONFLICT);
      case 'InvalidPin':
      case 'TrivialPin':
      case 'SameAsProvisionalPin':
        throw new HttpException(refusal, HttpStatus.BAD_REQUEST);
      case 'TooManyAttempts':
        response.setHeader('Retry-After', String(Math.max(1, Math.ceil((Date.parse(refusal.retryAt) - this.clock.now().getTime()) / 1_000))));
        throw new HttpException(refusal, HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}
