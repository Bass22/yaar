import { Inject, Injectable } from '@nestjs/common';
import type { Clock } from '@kit';
import type { Prisma } from '@prisma/client';
import type { TenantId } from '@domain/journal';
import { CLOCK } from '../auth/clock.token';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { PrismaService } from '../database/prisma.service';
import { birdsOf } from '../journal/birds';
import { PrismaJournal } from '../journal/prisma-journal';
import { correctionsToReview } from './corrections';
import { sendWebPush, type DeviceSubscription, type PushOutcome, type VapidKeys } from './web-push';
import type { PushKind } from '@contracts';

/** What the phone shows (Angular's service worker format): words and a kind — never an amount (rule 4). */
export type PushMessage = {
  readonly notification: {
    readonly title: string;
    readonly body: string;
    readonly icon: string;
    readonly tag: string;
    readonly data: {
      readonly kind: PushKind;
      readonly campaignId: string;
      /** What a tap opens (Y.4): Angular's service worker opens the application there, even closed. */
      readonly onActionClick: { readonly default: { readonly operation: 'navigateLastFocusedOrOpen'; readonly url: string } };
    };
  };
};

/** The closed list of kinds (Y.4): the phone knows each, and opens the home for any other. */

/** The port of the push services: one message to one device, and its fate. */
export type PushSender = (device: DeviceSubscription, payload: PushMessage) => Promise<PushOutcome>;
export const PUSH_SENDER = Symbol('PUSH_SENDER');

const ICON = '/icons/app-icon-192.png';
/** A business day as a message says it: « 21 novembre ». */
export const DAY_WORDS = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });

/** The message for its kind: the site and what comes, the site and the day (Y.2a). */
export function message(kind: PushKind, campaignId: string, title: string, body: string, tag: string): PushMessage {
  const url = `/notification?kind=${kind}&campaign=${encodeURIComponent(campaignId)}`;
  return { notification: { title, body, icon: ICON, tag, data: { kind, campaignId, onActionClick: { default: { operation: 'navigateLastFocusedOrOpen', url } } } } };
}

/**
 * Tells the caretakers of a site (Y.2a): the devices of the people assigned to it — caretakers
 * only, an admin is never assigned —, read when sending; never another site. A blocked account
 * has no device left (Y.1). Runs after the commit (`AfterCommit`): the
 * devices are read in one transaction, the messages leave outside any, a device the push service
 * says is gone is deleted. Without the keys configured, nothing leaves.
 */
@Injectable()
export class SiteNotifications {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PUSH_SENDER) private readonly send: PushSender,
  ) {}

  async deliveryAnnounced(tenantId: TenantId, orderId: string): Promise<void> {
    // Nothing can leave: nothing is read either.
    if (!this.configured()) return;
    const order = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.purchaseOrder.findUnique({ where: { id: orderId }, select: { campaign: { select: { id: true, site: { select: { id: true, name: true } } } }, lines: { orderBy: { position: 'asc' }, select: { costType: { select: { name: true } } } } } }),
    );
    if (order === null) return;
    const names = [...new Set(order.lines.map(({ costType }) => costType.name))].join(', ');
    await this.notifyCaretakers(tenantId, order.campaign.site.id, message('DeliveryAnnounced', order.campaign.id, 'Une livraison est annoncée', `${order.campaign.site.name} : ${names}`, 'delivery'));
  }

  async weighingRequested(tenantId: TenantId, weighingRequestId: string): Promise<void> {
    // Nothing can leave: nothing is read either.
    if (!this.configured()) return;
    const request = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.weighingRequest.findUnique({ where: { id: weighingRequestId }, select: { requestedFor: true, campaign: { select: { id: true, site: { select: { id: true, name: true } } } } } }),
    );
    if (request === null) return;
    const day = DAY_WORDS.format(request.requestedFor);
    await this.notifyCaretakers(tenantId, request.campaign.site.id, message('WeighingRequested', request.campaign.id, 'Le chef demande une pesée', `${request.campaign.site.name}, le ${day}`, 'weighing'));
  }

  /**
   * What a caretaker just wrote, told to the admins (Y.2b): each correction — before → after —,
   * and a flock whose deaths take the live count below zero. Read after the commit.
   */
  async journalWritten(tenantId: TenantId, ids: readonly string[]): Promise<void> {
    // Nothing can leave: nothing is read either.
    if (!this.configured()) return;
    const { corrections, tooManyDeaths } = await this.prisma.runInTenant(tenantId, async (tx) => {
      const corrections = await correctionsToReview(tx, ids);
      // Deaths and losses (missing, given, stolen) both leave the living (rule: received − deaths − losses − sold).
      const deaths = await tx.journalEvent.findMany({ where: { id: { in: [...ids] }, type: { in: ['Death', 'Loss'] } }, select: { campaignId: true, site: { select: { name: true } } } });
      const tooManyDeaths: { campaignId: string; siteName: string; liveCount: number }[] = [];
      for (const campaignId of new Set(deaths.map((death) => death.campaignId))) {
        const { liveCount } = await birdsOf(tx, campaignId, await new PrismaJournal(tx, tenantId).campaignJournal(campaignId));
        if (liveCount !== null && liveCount < 0) tooManyDeaths.push({ campaignId, siteName: deaths.find((death) => death.campaignId === campaignId)?.site.name ?? '', liveCount });
      }
      return { corrections, tooManyDeaths };
    });
    for (const correction of corrections) {
      await this.notifyAdmins(tenantId, message('CorrectionWritten', correction.campaignId, 'Le cahier est corrigé', `${correction.siteName}, J${correction.campaignDay} : ${correction.before} → ${correction.after}, par ${correction.authorName}`, `correction-${correction.correctionId}`));
    }
    for (const flock of tooManyDeaths) {
      // Signed, never brought back to zero (rule 9): « −2 ».
      await this.notifyAdmins(tenantId, message('TooManyDeaths', flock.campaignId, 'Plus de morts que de vivants', `${flock.siteName} : les vivants sont à \u2212${-flock.liveCount} — à vérifier`, `deaths-${flock.campaignId}`));
    }
  }

  async notifyCaretakers(tenantId: TenantId, siteId: string, payload: PushMessage): Promise<void> {
    await this.notify(tenantId, { user: { assignments: { some: { siteId } } } }, payload);
  }

  /** Every admin of the farm: they see all its sites. */
  async notifyAdmins(tenantId: TenantId, payload: PushMessage): Promise<void> {
    await this.notify(tenantId, { user: { role: 'admin' } }, payload);
  }

  private async notify(tenantId: TenantId, where: Prisma.PushSubscriptionWhereInput, payload: PushMessage): Promise<void> {
    const vapid = this.vapid();
    if (vapid === null) return;
    const devices = await this.prisma.runInTenant(tenantId, (tx) => tx.pushSubscription.findMany({ where, select: { deviceId: true, endpoint: true, p256dh: true, auth: true } }));
    const outcomes = await Promise.all(devices.map(async (device) => ({ device, outcome: await this.send(device, payload).catch((): PushOutcome => 'Failed') })));
    const gone = outcomes.filter(({ outcome }) => outcome === 'Gone').map(({ device }) => device.deviceId);
    if (gone.length > 0) await this.prisma.runInTenant(tenantId, (tx) => tx.pushSubscription.deleteMany({ where: { deviceId: { in: gone } } }));
  }

  /** Whether anything can leave: the three VAPID values are configured. */
  configured(): boolean {
    return this.vapid() !== null;
  }

  private vapid(): VapidKeys | null {
    const { vapidPublicKey, vapidPrivateKey, vapidSubject } = this.config;
    return vapidPublicKey && vapidPrivateKey && vapidSubject ? { publicKey: vapidPublicKey, privateKey: vapidPrivateKey, subject: vapidSubject } : null;
  }
}

/** The real push services: the message encrypted for the device, signed by the server (VAPID). */
export function webPushSender(config: AppConfig, clock: Clock): PushSender {
  return async (device, payload) => {
    const { vapidPublicKey, vapidPrivateKey, vapidSubject } = config;
    if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) return 'Failed';
    return sendWebPush(device, payload, { publicKey: vapidPublicKey, privateKey: vapidPrivateKey, subject: vapidSubject }, clock.now());
  };
}

export const PUSH_SENDER_PROVIDER = { provide: PUSH_SENDER, useFactory: webPushSender, inject: [APP_CONFIG, CLOCK] };
