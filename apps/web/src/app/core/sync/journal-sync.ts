import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { DestroyRef, Injectable, InjectionToken, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { FactPayload, JournalBatchResponse, JournalEventPayload } from '@contracts';
import { Outbox, OutboxUnavailable, type EventDraft, type OutboxEntry } from '../outbox/outbox';
import { AuthService } from '../session/auth';
import { synchronize, type SyncAnswer, type SyncStop } from './synchronize';

/** The outbox of the phone, opened once. */
export const OUTBOX = new InjectionToken<Promise<Outbox>>('OUTBOX', { providedIn: 'root', factory: () => Outbox.open() });

/**
 * The phone's side of the journal (G.3, G.4, G.5): a declaration goes to the outbox first, then
 * leaves when the network allows — at opening, when the network comes back, and after each
 * declaration. One synchronisation at a time. What it says is for the screens: how many events
 * wait (the sync badge), which were refused, and why the last synchronisation stopped.
 */
@Injectable({ providedIn: 'root' })
export class JournalSync {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly outbox = inject(OUTBOX);
  private running: Promise<void> | null = null;
  private again = false;

  readonly waiting = signal(0);
  readonly refused = signal<readonly OutboxEntry[]>([]);
  readonly stopped = signal<SyncStop | null>(null);
  /** The phone cannot keep the outbox (storage disabled, full): declarations would be lost — the screens say so. */
  readonly storageUnavailable = signal(false);
  /** Moves whenever the outbox may have changed — a declaration kept, an event sent: the notebook reads it again. */
  readonly revision = signal(0);

  constructor() {
    const onOnline = () => void this.sync();
    globalThis.addEventListener?.('online', onOnline);
    inject(DestroyRef).onDestroy(() => globalThis.removeEventListener?.('online', onOnline));
    void this.sync();
  }

  /**
   * Keeps a declaration of the person signed in. Resolves once it is stored on the phone — only
   * then may the screen show it as written; rejects if the phone cannot keep it.
   */
  async record(draft: EventDraft): Promise<OutboxEntry> {
    const session = this.auth.session();
    if (session.status === 'none') {
      throw new Error('Nobody is signed in on this phone: a declaration needs its author.');
    }
    const entry = await (await this.outbox).record(session.userId, draft);
    await this.refreshCounts();
    void this.sync();
    return entry;
  }

  /**
   * Changes the quantity of a declaration that never left the phone (K.5): same identifier, same
   * dates. Returns `false` when it already left — an attempt is in doubt, or it was sent.
   */
  async amend(id: string, quantity: number): Promise<boolean> {
    const outbox = await this.outbox;
    const entry = await outbox.find(id);
    if (entry === null || !('fact' in entry.payload) || !('quantity' in entry.payload.fact)) {
      return false;
    }
    // `replace` only changes an event that never left, and keeps its identifier.
    const replaced = await outbox.replace(id, { ...entry.payload, fact: { ...entry.payload.fact, quantity } } as EventDraft);
    await this.refreshCounts();
    return replaced;
  }

  /**
   * Sends a counter-declaration now, never through the outbox: a correction after sending needs
   * the network (decision of 2026-11-06). Without an answer nothing is kept — the caretaker tries
   * again, and a second correction to the same value changes nothing: the last written prevails.
   */
  async correct(draft: { readonly siteId: string; readonly campaignId: string; readonly businessDate: string; readonly recordedAt: string; readonly corrects: string; readonly fact: FactPayload }): Promise<SyncAnswer> {
    this.auth.refresh();
    const session = this.auth.session();
    if (session.status !== 'active') {
      return { kind: 'unauthorized' };
    }
    return this.send([{ ...draft, id: crypto.randomUUID() }], session.token);
  }

  /** Sends what waits. A call during a running synchronisation runs once more after it. */
  sync(): Promise<void> {
    if (this.running !== null) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        await this.syncOnce();
      } while (this.again);
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async syncOnce(): Promise<void> {
    this.auth.refresh();
    // The phone knows it has no network: no attempt, so nothing turns « in doubt » — a declaration
    // that never left stays free to correct (K.5). « Online » is not trusted the other way round.
    if (globalThis.navigator?.onLine === false) {
      this.stopped.set('Offline');
      await this.refreshCounts();
      return;
    }
    try {
      const report = await synchronize(await this.outbox, this.auth.session(), (events, token) => this.send(events, token), Date.now());
      this.stopped.set(report.stopped);
      await this.refreshCounts();
    } catch (error) {
      if (!(error instanceof OutboxUnavailable)) {
        throw error;
      }
      this.storageUnavailable.set(true);
    }
  }

  private async refreshCounts(): Promise<void> {
    const session = this.auth.session();
    if (session.status === 'none') {
      this.waiting.set(0);
      this.refused.set([]);
      return;
    }
    const outbox = await this.outbox;
    this.waiting.set(await outbox.waiting(session.userId));
    this.refused.set(await outbox.refused(session.userId));
    this.revision.update((revision) => revision + 1);
  }

  private async send(events: readonly JournalEventPayload[], token: string): Promise<SyncAnswer> {
    // The batch was just marked in doubt: the notebook locks its lines before the answer comes.
    this.revision.update((revision) => revision + 1);
    try {
      const response = await firstValueFrom(
        this.http.post<JournalBatchResponse>('/api/v1/journal/events', { events }, { headers: new HttpHeaders({ Authorization: `Bearer ${token}` }) }),
      );
      return { kind: 'outcomes', outcomes: response.outcomes };
    } catch (error) {
      // Any other failure — no network, a server down, a request it would not read — leaves the
      // events in doubt: they leave again, identical, at the next synchronisation.
      return error instanceof HttpErrorResponse && error.status === 401 ? { kind: 'unauthorized' } : { kind: 'unreachable' };
    }
  }
}
