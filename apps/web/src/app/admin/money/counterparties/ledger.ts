import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { LedgerView, RecordSettlementRequest, SettlementRefusalCode } from '@contracts';
import { clip, number, type PhrasePart } from '../../../core/audio/phrase';
import { CLOCK } from '../../../core/clock';
import { AuthService } from '../../../core/session/auth';
import { OfficeSync, recall, remember } from '../../office-sync';

export type SettlementProblem = SettlementRefusalCode | 'NoMethod' | 'NoNetwork' | 'ServerError' | 'StorageUnavailable';

/** What the voice says of a balance: the direction first, then the amount (screen 10). */
export function balancePhrase(balance: number): PhrasePart[] {
  if (balance === 0) return [clip('ledger-settled')];
  return [clip(balance < 0 ? 'ledger-you-owe' : 'ledger-owes-you'), number(Math.abs(balance)), clip('money-francs')];
}

/**
 * « Qui doit quoi » at the office (R.3): the ledger as the server sums it — the screen adds
 * nothing up — and the settlements written from a counterparty's line. Online until P.7.
 */
@Injectable()
export class Ledger {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly office = inject(OfficeSync);
  private readonly clock = inject(CLOCK);

  readonly view = signal<LedgerView | null>(null);
  readonly unreachable = signal(false);
  /** When the balances shown were read; without network, the last reading kept on the device (P.7). */
  readonly readAt = signal<string | null>(null);

  async load(): Promise<void> {
    const url = '/api/v1/ledger';
    const session = this.auth.session();
    const userId = session.status === 'none' ? '' : session.userId;
    try {
      const view = await firstValueFrom(this.http.get<LedgerView>(url, { headers: this.headers() }));
      const at = this.clock.now();
      remember(userId, url, view, at);
      this.view.set(view);
      this.readAt.set(at.toISOString());
      this.unreachable.set(false);
    } catch {
      const kept = recall<LedgerView>(userId, url);
      if (kept !== null) {
        this.view.set(kept.value);
        this.readAt.set(kept.readAt);
      }
      this.unreachable.set(true);
    }
  }

  /** A settlement (R.2), kept on the device first and sent when the network allows (P.7); the server keeps it once. */
  async settle(request: RecordSettlementRequest): Promise<SettlementProblem | null> {
    return (await this.office.keep('settlement', '/api/v1/settlements', { ...request }, request.counterpartyId)) ? null : 'StorageUnavailable';
  }

  private headers(): HttpHeaders {
    const session = this.auth.session();
    return new HttpHeaders(session.status === 'none' ? {} : { Authorization: `Bearer ${session.token}` });
  }
}
