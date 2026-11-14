import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, NotFoundException, Put } from '@nestjs/common';
import type { PushPublicKeyView, SubscribeToPushRequest } from '@contracts';
import { CurrentSession, type Session } from '../auth/session';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { PrismaService } from '../database/prisma.service';
import { subscribeToPush, unsubscribeDevice } from './push-subscription';

// Subscribing to notifications (Y.1): every role, for the device signed in. Without a key
// configured, nothing is offered (fail-closed): the public key and the subscription answer 404.
@Controller()
export class PushSubscriptionsController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('push/public-key')
  publicKey(): PushPublicKeyView {
    return { publicKey: this.configuredKey() };
  }

  @Put('push-subscription')
  @HttpCode(HttpStatus.NO_CONTENT)
  async subscribe(@CurrentSession() session: Session, @Body() body: unknown): Promise<void> {
    this.configuredKey();
    const request = requestOf(body);
    const result = await this.prisma.runInTenant(session.tenantId, (tx) => subscribeToPush(tx, session, request));
    if (!result.ok) throw new BadRequestException({ kind: result.error.kind });
  }

  @Delete('push-subscription')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unsubscribe(@CurrentSession() session: Session): Promise<void> {
    await this.prisma.runInTenant(session.tenantId, (tx) => unsubscribeDevice(tx, session));
  }

  private configuredKey(): string {
    const key = this.config.vapidPublicKey ?? null;
    if (key === null) throw new NotFoundException({ kind: 'PushNotConfigured' });
    return key;
  }
}

// Whitelist at the border: exactly the endpoint and its two keys, as the browser gives them.
function requestOf(body: unknown): SubscribeToPushRequest {
  const values = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  const keys = values?.['keys'];
  const valid =
    values !== null &&
    Object.keys(values).sort().join() === 'endpoint,keys' &&
    typeof values['endpoint'] === 'string' &&
    typeof keys === 'object' &&
    keys !== null &&
    Object.keys(keys).sort().join() === 'auth,p256dh' &&
    typeof (keys as Record<string, unknown>)['auth'] === 'string' &&
    typeof (keys as Record<string, unknown>)['p256dh'] === 'string';
  if (!valid) throw new BadRequestException({ kind: 'InvalidSubscription' });
  return values as unknown as SubscribeToPushRequest;
}
