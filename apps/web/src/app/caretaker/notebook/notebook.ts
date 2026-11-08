import { HttpClient, HttpHeaders } from '@angular/common/http';
import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TimeZone, type BusinessDay } from '@domain/journal';
import type { CaretakerContext } from '@contracts';
import { CLOCK } from '../../core/clock';
import type { OutboxEntry } from '../../core/outbox/outbox';
import { AuthService } from '../../core/session/auth';
import { tenantOf } from '../../core/session/session-store';
import { JournalSync, OUTBOX } from '../../core/sync/journal-sync';
import { daysOf, campaignsOf, journalOf, linesOf, liveCountOf, summaryOf, type NotebookCampaign, type NotebookDay } from './notebook-view';

const CONTEXT_KEY = 'yaar.context';
const MINUTE = 60_000;

/** Where the next declaration goes: the site, the campaign chosen, and the day chosen — today, or a day caught up (J.2). */
export type DeclarationTarget = { readonly siteId: string; readonly campaignId: string; readonly businessDate: BusinessDay };

/**
 * The state of the caretaker's notebook (epic J): the last context the server sent — kept on the
 * phone, so that the notebook opens offline —, what the outbox keeps, the campaign and the day
 * chosen. The phone's clock and the site's time zone tell the day: day J moves on offline too.
 * One site per caretaker for now (decision of 2026-11-07): the notebook opens on the first.
 */
@Injectable()
export class Notebook {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly sync = inject(JournalSync);
  private readonly outbox = inject(OUTBOX);
  private readonly clock = inject(CLOCK);
  private readonly storage = globalThis.localStorage;

  /** The last context received for the person signed in; `null` before the first one. */
  readonly context = signal<CaretakerContext | null>(this.cached());
  /** The last request for the context got no answer: the notebook shows the one kept. */
  readonly unreachable = signal(false);
  readonly now = signal(this.clock.now());
  private readonly entries = signal<readonly OutboxEntry[]>([]);
  private readonly chosenCampaignId = signal<string | null>(null);
  private readonly chosenDay = signal<BusinessDay | null>(null);

  readonly userId = computed(() => {
    const session = this.auth.session();
    return session.status === 'none' ? null : session.userId;
  });
  readonly account = computed(() => {
    const session = this.auth.session();
    return session.status === 'none' ? null : session.account;
  });
  readonly site = computed(() => this.context()?.sites[0] ?? null);
  readonly isPrimaryCaretaker = computed(() => this.site() !== null && this.site()?.primaryCaretakerId === this.userId());
  readonly days = computed((): NotebookDay[] => {
    const site = this.site();
    const timeZone = site === null ? null : TimeZone(site.timeZone);
    return timeZone === null || !timeZone.ok ? [] : daysOf(this.now(), timeZone.value);
  });
  readonly campaigns = computed((): NotebookCampaign[] => {
    const site = this.site();
    const today = this.days()[2];
    return site === null || today === undefined ? [] : campaignsOf(site.campaigns, today.day);
  });
  /** The campaign the notebook writes on: the only one, or the one chosen at opening — none before. */
  readonly campaign = computed(() => {
    const campaigns = this.campaigns();
    return campaigns.length === 1 ? (campaigns[0] ?? null) : (campaigns.find((campaign) => campaign.campaignId === this.chosenCampaignId()) ?? null);
  });
  private readonly campaignContext = computed(() => this.site()?.campaigns.find((campaign) => campaign.campaignId === this.campaign()?.campaignId) ?? null);
  /** The day chosen; today when none is, or once the chosen one has left the three days. */
  readonly day = computed(() => this.days().find((day) => day.day === this.chosenDay()) ?? this.days()[2] ?? null);
  private readonly journal = computed(() => {
    const campaign = this.campaignContext();
    const site = this.site();
    const session = this.auth.session();
    const tenantId = session.status === 'none' ? null : tenantOf(session.token);
    return campaign === null || site === null || tenantId === null ? [] : journalOf(campaign, this.entries(), { tenantId, siteId: site.siteId });
  });
  readonly tabs = computed(() => {
    const campaign = this.campaignContext();
    return campaign === null ? [] : this.days().map((day) => ({ ...day, summary: summaryOf(this.journal(), campaign.campaignId, day.day) }));
  });
  readonly lines = computed(() => {
    const campaign = this.campaignContext();
    const day = this.day();
    return campaign === null || day === null ? [] : linesOf(campaign, this.journal(), this.entries(), day.day);
  });
  /** The live count of the campaign, less the deaths the server has not counted yet (K.1). */
  readonly liveCount = computed(() => {
    const campaign = this.campaignContext();
    const oldest = this.days()[0];
    return campaign === null || oldest === undefined ? null : liveCountOf(campaign, this.entries(), oldest.day);
  });
  /** The deaths already written on the chosen day, by anyone, `null` when none: what the voice reminds before the Oui (K.1). */
  readonly deathsWritten = computed(() => {
    const campaign = this.campaign();
    const day = this.day();
    const mortality = campaign === null || day === null ? null : summaryOf(this.journal(), campaign.campaignId, day.day).mortality;
    return mortality?.kind === 'DeathsDeclared' ? mortality.deaths : null;
  });
  /** The bags opened already written on the chosen day, by anyone, `null` when none: the same reminder (K.3). */
  readonly bagsWritten = computed(() => {
    const campaign = this.campaign();
    const day = this.day();
    const bags = campaign === null || day === null ? [] : summaryOf(this.journal(), campaign.campaignId, day.day).bagsOpened;
    return bags.length === 0 ? null : bags.reduce((sum, entry) => sum + entry.quantity, 0);
  });
  /**
   * Yesterday, while its deaths are not written — neither deaths nor « rien perdu »; a bag does not
   * count (K.4, decision of 2026-11-08). Only on today's page, and not for a campaign placed today.
   */
  readonly forgottenYesterday = computed((): DeclarationTarget | null => {
    const site = this.site();
    const campaign = this.campaign();
    const yesterday = this.days()[1];
    if (site === null || campaign === null || yesterday === undefined || this.day()?.when !== 'today' || campaign.campaignDay < 1) {
      return null;
    }
    const forgotten = summaryOf(this.journal(), campaign.campaignId, yesterday.day).mortality.kind === 'NotDeclared';
    return forgotten ? { siteId: site.siteId, campaignId: campaign.campaignId, businessDate: yesterday.day } : null;
  });
  /** What a gesture of the notebook writes on (lot 2, K): nothing until a campaign is chosen. */
  readonly declarationTarget = computed((): DeclarationTarget | null => {
    const site = this.site();
    const campaign = this.campaign();
    const day = this.day();
    return site === null || campaign === null || day === null ? null : { siteId: site.siteId, campaignId: campaign.campaignId, businessDate: day.day };
  });

  constructor() {
    const tick = setInterval(() => this.now.set(this.clock.now()), MINUTE);
    const onOnline = () => void this.refresh();
    globalThis.addEventListener?.('online', onOnline);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(tick);
      globalThis.removeEventListener?.('online', onOnline);
    });
    // The outbox is read again whenever it may have changed, or the campaign changes.
    effect(() => {
      this.sync.revision();
      const campaignId = this.campaign()?.campaignId;
      if (campaignId !== undefined) {
        void this.readOutbox(campaignId);
      }
    });
    void this.refresh();
  }

  chooseCampaign(campaignId: string): void {
    this.chosenCampaignId.set(campaignId);
  }

  chooseDay(day: BusinessDay): void {
    this.chosenDay.set(day);
  }

  /** The name of whoever wrote a line: the person signed in, or the server's. */
  nameOf(authorId: string): string {
    if (authorId === this.userId()) {
      return this.account()?.name ?? '';
    }
    return (
      this.site()
        ?.campaigns.flatMap((campaign) => campaign.journal)
        .find((line) => line.author.id === authorId)?.author.name ?? ''
    );
  }

  /** Asks the server for the notebook; without an answer, the one kept stays. */
  async refresh(): Promise<void> {
    const session = this.auth.session();
    if (session.status !== 'active') {
      return;
    }
    try {
      const context = await firstValueFrom(this.http.get<CaretakerContext>('/api/v1/caretaker/context', { headers: new HttpHeaders({ Authorization: `Bearer ${session.token}` }) }));
      this.context.set(context);
      this.unreachable.set(false);
      this.now.set(this.clock.now());
      this.keep(session.userId, context);
    } catch {
      this.unreachable.set(true);
    }
  }

  private async readOutbox(campaignId: string): Promise<void> {
    try {
      this.entries.set(await (await this.outbox).entriesOf(campaignId));
    } catch {
      // Without its storage, the phone shows what the server sent; the sync says the storage is missing.
      this.entries.set([]);
    }
  }

  // The context is kept for the person who received it only: another account signed in on this phone never sees it.
  private cached(): CaretakerContext | null {
    try {
      const kept = JSON.parse(this.storage.getItem(CONTEXT_KEY) ?? 'null') as { userId?: unknown; context?: CaretakerContext } | null;
      const session = this.auth.session();
      return kept !== null && session.status !== 'none' && kept.userId === session.userId && kept.context !== undefined ? kept.context : null;
    } catch {
      return null;
    }
  }

  private keep(userId: string, context: CaretakerContext): void {
    try {
      this.storage.setItem(CONTEXT_KEY, JSON.stringify({ userId, context }));
    } catch {
      // A full storage only costs the offline opening of the next time.
    }
  }
}
