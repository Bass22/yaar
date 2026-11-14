import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { unwrap, type Clock } from '@kit';
import { CampaignId, morningReminderDay, summarizeDay, TimeZone, type TenantId } from '@domain/journal';
import { CLOCK } from '../auth/clock.token';
import { PrismaService } from '../database/prisma.service';
import { PrismaJournal } from '../journal/prisma-journal';
import { ReceptionAlerts } from './reception-alerts';
import { message, SiteNotifications } from './site-notifications';

const EVERY_MS = 5 * 60_000;

/**
 * The morning reminder (Y.3; founder's decisions of 2026-11-14): from 07:00, the site's time, a
 * site where a flock running yesterday has nothing written for yesterday's deaths — neither
 * deaths nor « Rien perdu » — tells its whole team, and leads to the post-it « Rien perdu hier ».
 * Once per day and per site: the row written first decides, whatever restarts. Nothing for a
 * site without a flock running yesterday, nor without notification keys.
 */
@Injectable()
export class MorningReminders implements OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: SiteNotifications,
    private readonly receptions: ReceptionAlerts,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Looked at every five minutes, from the start of the server (main.ts); never in the tests. */
  start(): void {
    this.timer ??= setInterval(() => void this.remind().catch(() => undefined), EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  async remind(): Promise<void> {
    if (!this.notifications.configured()) return;
    const now = this.clock.now();
    for (const tenantId of await this.prisma.tenantIds()) {
      // A farm that fails does not stop the others.
      await this.remindFarm(tenantId, now).catch(() => undefined);
      // The same morning round tells of the receptions of the day (Q.15).
      await this.receptions.morning(tenantId, now).catch(() => undefined);
    }
  }

  private async remindFarm(tenantId: TenantId, now: Date): Promise<void> {
    const due = await this.prisma.runInTenant(tenantId, async (tx) => {
      const sites = await tx.site.findMany({ select: { id: true, name: true, timeZone: true, campaigns: { where: { closedAt: null }, select: { id: true, placementDay: true } } } });
      const toRemind: { siteId: string; siteName: string; campaignId: string }[] = [];
      for (const site of sites) {
        const day = morningReminderDay(now, unwrap(TimeZone(site.timeZone)));
        if (day === null) continue;
        const running = site.campaigns.filter(({ placementDay }) => placementDay.toISOString().slice(0, 10) <= day);
        let silent: string | null = null;
        for (const campaign of running) {
          const events = await new PrismaJournal(tx, tenantId).campaignJournal(campaign.id);
          if (summarizeDay(events, { campaignId: unwrap(CampaignId(campaign.id)), businessDate: day }).mortality.kind === 'NotDeclared') {
            silent = campaign.id;
            break;
          }
        }
        if (silent === null) continue;
        // Once per day and per site: only the writing that adds the row sends.
        const added = await tx.$executeRaw`INSERT INTO morning_reminders (tenant_id, site_id, day, sent_at) VALUES (${tenantId}::uuid, ${site.id}::uuid, ${day}::date, ${now}) ON CONFLICT DO NOTHING`;
        if (added === 1) toRemind.push({ siteId: site.id, siteName: site.name, campaignId: silent });
      }
      return toRemind;
    });
    for (const site of due) {
      await this.notifications.notifyCaretakers(tenantId, site.siteId, message('MorningReminder', site.campaignId, 'Le cahier attend', `${site.siteName} : les morts d’hier ne sont pas écrits. Rien perdu ? Dis-le aussi.`, `morning-${site.siteId}`));
    }
  }
}
