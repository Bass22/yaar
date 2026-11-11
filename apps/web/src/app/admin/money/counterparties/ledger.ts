import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { LedgerView, RecordSettlementRequest, SettlementRefusalCode } from '@contracts';
import { clip, number, type PhrasePart } from '../../../core/audio/phrase';
import { AuthService } from '../../../core/session/auth';

export type SettlementProblem = SettlementRefusalCode | 'NoMethod' | 'NoNetwork' | 'ServerError';

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

  readonly view = signal<LedgerView | null>(null);
  readonly unreachable = signal(false);

  async load(): Promise<void> {
    try {
      this.view.set(await firstValueFrom(this.http.get<LedgerView>('/api/v1/ledger', { headers: this.headers() })));
      this.unreachable.set(false);
    } catch {
      this.unreachable.set(true);
    }
  }

  /** A settlement (R.2). Sent again with the same identifier, the server keeps it once. */
  async settle(request: RecordSettlementRequest): Promise<SettlementProblem | null> {
    try {
      await firstValueFrom(this.http.post('/api/v1/settlements', request, { headers: this.headers() }));
      return null;
    } catch (error) {
      if (!(error instanceof HttpErrorResponse) || error.status === 0) return 'NoNetwork';
      const kind = (error.error as { kind?: unknown } | null)?.kind;
      return typeof kind === 'string' ? (kind as SettlementProblem) : 'ServerError';
    }
  }

  private headers(): HttpHeaders {
    const session = this.auth.session();
    return new HttpHeaders(session.status === 'none' ? {} : { Authorization: `Bearer ${session.token}` });
  }
}
