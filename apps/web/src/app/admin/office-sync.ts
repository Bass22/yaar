import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { DestroyRef, Injectable, InjectionToken, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { OfficeQueue, synchronizeOffice, type OfficeAnswer, type OfficeEntry, type OfficeEntryKind } from '../core/outbox/office-queue';
import { AuthService } from '../core/session/auth';

/** The office's queue, opened once; `null` when the device cannot keep it. */
export const OFFICE_QUEUE = new InjectionToken<Promise<OfficeQueue | null>>('OFFICE_QUEUE', { providedIn: 'root', factory: () => OfficeQueue.open().catch(() => null) });

/**
 * The office's side of the queue (P.7): a money entry is kept on the device before any call, then
 * leaves — after each entry, at opening, when the network comes back. One synchronisation at a
 * time. The screens read what waits and what was refused, and read their figures again when
 * something was sent (`revision`).
 */
@Injectable({ providedIn: 'root' })
export class OfficeSync {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly queue = inject(OFFICE_QUEUE);
  private running: Promise<void> | null = null;
  private again = false;

  /** This account's entries still on the device: pending, or refused with their reason. */
  readonly entries = signal<readonly OfficeEntry[]>([]);
  /** Moves when the server has received something: the screens read their figures again. */
  readonly revision = signal(0);

  constructor() {
    const onOnline = () => void this.sync();
    globalThis.addEventListener?.('online', onOnline);
    inject(DestroyRef).onDestroy(() => globalThis.removeEventListener?.('online', onOnline));
    void this.sync();
  }

  /** Keeps a money entry of the person signed in, then tries to send it. `false` when the device cannot keep it. */
  async keep(kind: OfficeEntryKind, url: string, body: OfficeEntry['body'], subject: string): Promise<boolean> {
    const session = this.auth.session();
    const queue = await this.queue;
    if (session.status === 'none' || queue === null) return false;
    try {
      await queue.keep(session.userId, kind, url, body, subject);
    } catch {
      return false;
    }
    await this.refresh();
    void this.sync();
    return true;
  }

  /** « J'ai vu » on a refusal: it leaves the list. */
  async dismiss(id: string): Promise<void> {
    await (await this.queue)?.dismiss(id);
    await this.refresh();
  }

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
    const queue = await this.queue;
    if (queue === null) return;
    if (globalThis.navigator?.onLine !== false) {
      const report = await synchronizeOffice(queue, this.auth.session(), (url, body, token) => this.send(url, body, token));
      if (report.sent > 0 || report.refused > 0) this.revision.update((revision) => revision + 1);
    }
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    const session = this.auth.session();
    const queue = await this.queue;
    this.entries.set(session.status === 'none' || queue === null ? [] : await queue.entries(session.userId));
  }

  private async send(url: string, body: OfficeEntry['body'], token: string): Promise<OfficeAnswer> {
    try {
      await firstValueFrom(this.http.post(url, body, { headers: new HttpHeaders({ Authorization: `Bearer ${token}` }) }));
      return { kind: 'sent' };
    } catch (error) {
      if (!(error instanceof HttpErrorResponse) || error.status === 0 || error.status >= 500) return { kind: 'unreachable' };
      if (error.status === 401 || error.status === 403) return { kind: 'unauthorized' };
      const refusal = (error.error as { kind?: unknown } | null)?.kind;
      return { kind: 'refused', refusal: typeof refusal === 'string' ? refusal : error.status === 404 ? 'NotFound' : 'Refused' };
    }
  }
}

/** The last reading of an office screen, kept on the device by account (P.7): shown without network, with its time. */
export type Reading<T> = { readonly value: T; readonly readAt: string };

const CACHE_PREFIX = 'yaar.office';

export function remember<T>(userId: string, url: string, value: T, at: Date): void {
  try {
    localStorage.setItem(`${CACHE_PREFIX}.${userId}.${url}`, JSON.stringify({ value, readAt: at.toISOString() }));
  } catch {
    // A device that keeps nothing: the screen says there is no network, as before.
  }
}

export function recall<T>(userId: string, url: string): Reading<T> | null {
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}.${userId}.${url}`);
    return raw === null ? null : (JSON.parse(raw) as Reading<T>);
  } catch {
    return null;
  }
}
