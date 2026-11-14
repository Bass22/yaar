import { Inject, Injectable } from '@nestjs/common';
import { unwrap, type Clock } from '@kit';
import { receptionProgress } from '@domain/finance';
import { businessDayAt, morningReminderDay, TimeZone, type BusinessDay, type TenantId } from '@domain/journal';
import { CLOCK } from '../auth/clock.token';
import { PrismaService } from '../database/prisma.service';
import { activeReceptions } from '../orders/active-receptions';
import { receivedByCampaign } from '../orders/orders';
import { DAY_WORDS, message, SiteNotifications } from './site-notifications';

type Due = { readonly receptionId: string; readonly siteId: string; readonly campaignId: string; readonly words: string };

/**
 * The alerts of the planned receptions (Q.15; founder's decisions of 2026-11-14): a reception tells
 * the caretakers of its site the morning of its day, at 07:00; written when its day has come
 * already — today or a past day —, it tells them the day it is written. Once per reception and per
 * day: the row written first decides. A reception all received tells nothing.
 */
@Injectable()
export class ReceptionAlerts {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: SiteNotifications,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** A reception just written (planned or rescheduled): its day has come, it tells now. */
  async written(tenantId: TenantId, receptionId: string): Promise<void> {
    if (!this.notifications.configured()) return;
    await this.alert(tenantId, this.clock.now(), (plannedOn, today) => plannedOn <= today, receptionId);
  }

  /** The morning round (with the morning reminder): from 07:00, the site's time, the receptions of the day. */
  async morning(tenantId: TenantId, now: Date): Promise<void> {
    if (!this.notifications.configured()) return;
    await this.alert(tenantId, now, (plannedOn, today, timeZone) => plannedOn === today && morningReminderDay(now, timeZone) !== null);
  }

  private async alert(tenantId: TenantId, now: Date, due: (plannedOn: BusinessDay, today: BusinessDay, timeZone: TimeZone) => boolean, only?: string): Promise<void> {
    const toSend = await this.prisma.runInTenant(tenantId, async (tx) => {
      const orders = await tx.purchaseOrder.findMany({
        where: { announcedAt: { not: null }, closedAt: null },
        select: { id: true, campaign: { select: { id: true, site: { select: { id: true, name: true, timeZone: true } } } }, lines: { select: { id: true, costType: { select: { name: true } } } } },
      });
      const planned = await activeReceptions(tx, orders.map(({ id }) => id));
      const sending: Due[] = [];
      for (const order of orders) {
        const receptions = (planned.get(order.id) ?? []).filter(({ receptionId }) => only === undefined || receptionId === only);
        if (receptions.length === 0) continue;
        const timeZone = unwrap(TimeZone(order.campaign.site.timeZone));
        const today = businessDayAt(now, timeZone);
        const received = (await receivedByCampaign(tx, tenantId, [order.campaign.id])).get(order.campaign.id) ?? new Map<string, number>();
        // Progress over every reception of the order: what came fills them in the order of their days.
        const progress = receptionProgress(planned.get(order.id) ?? [], received, today);
        for (const reception of receptions) {
          const state = progress.find(({ receptionId }) => receptionId === reception.receptionId)?.state;
          if (state === undefined || state === 'Received' || !due(reception.plannedOn, today, timeZone)) continue;
          // Once per reception and per day: only the writing that adds the row sends.
          const added = await tx.$executeRaw`INSERT INTO reception_alerts (tenant_id, reception_id, day, sent_at) VALUES (${tenantId}::uuid, ${reception.receptionId}::uuid, ${today}::date, ${now}) ON CONFLICT DO NOTHING`;
          if (added !== 1) continue;
          const names = [...new Set(reception.lines.map(({ orderLineId }) => order.lines.find(({ id }) => id === orderLineId)?.costType.name ?? ''))].join(', ');
          const when = reception.plannedOn === today ? 'aujourd’hui' : `prévue le ${DAY_WORDS.format(new Date(reception.plannedOn))}`;
          sending.push({ receptionId: reception.receptionId, siteId: order.campaign.site.id, campaignId: order.campaign.id, words: `${order.campaign.site.name}, ${when} : ${names}` });
        }
      }
      return sending;
    });
    for (const one of toSend) {
      await this.notifications.notifyCaretakers(tenantId, one.siteId, message('DeliveryAnnounced', one.campaignId, 'Une livraison est attendue', one.words, `reception-${one.receptionId}`));
    }
  }
}
