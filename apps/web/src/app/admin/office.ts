import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { CaretakerContext } from '@contracts';
import { CLOCK } from '../core/clock';
import { AuthService } from '../core/session/auth';

const OFFICE_KEY = 'yaar.office';

/** A lot of the farm as the office lists it: a running campaign on its site. */
export type OfficeLot = {
  readonly campaignId: string;
  readonly siteName: string;
  readonly campaignDay: number;
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
      site.campaigns.map((campaign) => ({ campaignId: campaign.campaignId, siteName: site.name, campaignDay: campaign.campaignDay, liveCount: campaign.liveCount })),
    ),
  );
  /** The farm's sites, with the day it is on each. */
  readonly sites = computed(() => (this.kept()?.context.sites ?? []).map(({ siteId, name, today }) => ({ siteId, name, today })));
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
