import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { CaretakerContext } from '@contracts';
import { CLOCK } from '../core/clock';
import { AuthService } from '../core/session/auth';

const OFFICE_KEY = 'yaar.office';
/** The lot the office works on (O.6), kept on this device for the person who chose it. */
const LOT_KEY = 'yaar.office.lot';

/** How the office says the day of a lot: « Jour 23 », or « dans 3 jours » before its placement (O.5). */
export const dayLabelOf = (campaignDay: number): string =>
  campaignDay >= 0 ? `Jour ${campaignDay}` : `dans ${-campaignDay} jour${campaignDay < -1 ? 's' : ''}`;

/** A lot of the farm as the office lists it: a running campaign on its site. */
export type OfficeLot = {
  readonly campaignId: string;
  readonly siteId: string;
  readonly siteName: string;
  readonly campaignDay: number;
  /** « Jour 23 » ; a campaign opened ahead (O.5) says « dans 3 jours » until its day 0. */
  readonly dayLabel: string;
  /** `null` while the chicks received are unknown: said, never shown as zero. */
  readonly liveCount: number | null;
};

/**
 * What the office reads (O.3): the farm's sites and running campaigns, from the server. The
 * last reading is kept, with its date, for the person who received it only: offline, the office
 * shows it and says how old its figures are (CLAUDE.md §4 rule 3). For now it reads the
 * notebook's context, which the admin receives for every site of the farm and which carries no
 * amount; the office's own reading comes with its figures (O.4).
 */
@Injectable()
export class Office {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly clock = inject(CLOCK);
  private readonly storage = globalThis.localStorage;

  private readonly kept = signal(this.cached());
  /** The last reading did not come: the office shows the one kept. */
  readonly unreachable = signal(false);
  readonly account = computed(() => {
    const session = this.auth.session();
    return session.status === 'none' ? null : session.account;
  });
  readonly lots = computed((): OfficeLot[] =>
    (this.kept()?.context.sites ?? []).flatMap((site) =>
      site.campaigns.map((campaign) => ({ campaignId: campaign.campaignId, siteId: site.siteId, siteName: site.name, campaignDay: campaign.campaignDay, dayLabel: dayLabelOf(campaign.campaignDay), liveCount: campaign.liveCount })),
    ),
  );
  private readonly chosenLot = signal<string | null>(this.keptLot());
  /**
   * The lot the office works on (O.6, after bureau-admin-v2.html « Changer de lot »): chosen once,
   * kept on this device, changed when one wants; the first running lot until one is chosen — with
   * a single lot, that one. Every page of a lot names it, so that nothing is written on the wrong one.
   */
  readonly currentLot = computed(() => this.lots().find((lot) => lot.campaignId === this.chosenLot()) ?? this.lots()[0] ?? null);
  /** The farm's sites, with the day it is on each. */
  readonly sites = computed(() => (this.kept()?.context.sites ?? []).map(({ siteId, name, today }) => ({ siteId, name, today })));
  /** The office's today: the first site's business day — what every money writing defaults to. */
  readonly today = computed(() => this.sites()[0]?.today ?? '');
  /** When the figures shown were read, and in which time zone to say it. */
  readonly readAt = computed(() => {
    const kept = this.kept();
    return kept === null ? null : { at: kept.readAt, timeZone: kept.context.sites[0]?.timeZone ?? 'UTC' };
  });

  constructor() {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    const session = this.auth.session();
    if (session.status !== 'active') {
      return;
    }
    try {
      const context = await firstValueFrom(this.http.get<CaretakerContext>('/api/v1/caretaker/context', { headers: new HttpHeaders({ Authorization: `Bearer ${session.token}` }) }));
      const reading = { userId: session.userId, readAt: this.clock.now().toISOString(), context };
      this.kept.set(reading);
      this.unreachable.set(false);
      try {
        this.storage.setItem(OFFICE_KEY, JSON.stringify(reading));
      } catch {
        // A full storage only costs the offline opening of the next time.
      }
    } catch {
      this.unreachable.set(true);
    }
  }

  /** Makes a lot the one the office works on, and keeps it for the next opening. */
  chooseLot(campaignId: string): void {
    this.chosenLot.set(campaignId);
    const session = this.auth.session();
    if (session.status === 'none') return;
    try {
      this.storage.setItem(LOT_KEY, JSON.stringify({ userId: session.userId, campaignId }));
    } catch {
      // A full storage only costs choosing again next time.
    }
  }

  private keptLot(): string | null {
    try {
      const kept = JSON.parse(this.storage.getItem(LOT_KEY) ?? 'null') as { userId?: unknown; campaignId?: unknown } | null;
      const session = this.auth.session();
      return kept !== null && session.status !== 'none' && kept.userId === session.userId && typeof kept.campaignId === 'string' ? kept.campaignId : null;
    } catch {
      return null;
    }
  }

  // Kept for the person who read it only: another account on this phone never sees it.
  private cached(): { readonly userId: string; readonly readAt: string; readonly context: CaretakerContext } | null {
    try {
      const kept = JSON.parse(this.storage.getItem(OFFICE_KEY) ?? 'null') as { userId?: unknown; readAt?: unknown; context?: CaretakerContext } | null;
      const session = this.auth.session();
      return kept !== null && session.status !== 'none' && kept.userId === session.userId && typeof kept.readAt === 'string' && kept.context !== undefined
        ? { userId: kept.userId, readAt: kept.readAt, context: kept.context }
        : null;
    } catch {
      return null;
    }
  }
}
