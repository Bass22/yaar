import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { RecordWeighingRequest, WeighingsView, WeighingToValidate } from '@contracts';
import { CLOCK } from '../../core/clock';
import { AuthService } from '../../core/session/auth';
import { readOrRecall } from '../office-sync';
import { authHeaders } from '../../core/session/auth-headers';

/** Why the office could not do it: the server's refusal, or no network — both said. */
export type WeighingProblem = string;

type Outcome = { readonly status: string; readonly refusal?: { readonly kind: string } };

/**
 * The weighings of a lot at the office (T.2, T.5): the real curve and what waits for validation, as
 * the server reads them. Asking for a weighing and validating one need the network: a correction
 * after sending is written online (CLAUDE.md §4, rule 3).
 */
@Injectable()
export class Weighings {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly clock = inject(CLOCK);

  readonly view = signal<WeighingsView | null>(null);
  readonly unreachable = signal(false);
  readonly readAt = signal<string | null>(null);

  private headers(): HttpHeaders {
    const session = this.auth.session();
    return authHeaders(session);
  }

  private userId(): string {
    const session = this.auth.session();
    return session.status === 'none' ? '' : session.userId;
  }

  async load(campaignId: string): Promise<void> {
    const url = `/api/v1/campaigns/${campaignId}/weighings`;
    await readOrRecall<WeighingsView>(this.http, url, this.userId(), this.headers(), () => this.clock.now(), (reading, online) => {
      if (reading !== null) {
        this.view.set(reading.value);
        this.readAt.set(reading.readAt);
      }
      this.unreachable.set(!online);
    });
  }

  /** A photo of the scale (T.6), read with the admin's session: a local address to show it, `null` when it cannot be read. */
  async photo(fingerprint: string): Promise<string | null> {
    try {
      const blob = await firstValueFrom(this.http.get(`/api/v1/media/${fingerprint}`, { headers: this.headers(), responseType: 'blob' }));
      return URL.createObjectURL(blob);
    } catch {
      return null;
    }
  }

  /** The chef asks for a weighing of a flock, on a day. */
  async ask(request: RecordWeighingRequest): Promise<WeighingProblem | null> {
    try {
      await firstValueFrom(this.http.post('/api/v1/weighing-requests', request, { headers: this.headers() }));
      return null;
    } catch (error) {
      return problemOf(error);
    }
  }

  /**
   * Validates a weighing: if a weight changed, a counter-declaration first — the weights as typed,
   * the original staying in the journal —, then the validation. Both on the weighing's day and site.
   */
  async validate(view: WeighingsView, weighing: WeighingToValidate, weights: readonly number[]): Promise<WeighingProblem | null> {
    const recordedAt = this.clock.now().toISOString();
    const envelope = { siteId: view.siteId, campaignId: view.campaignId, businessDate: weighing.businessDate, recordedAt };
    const changed = weights.some((grams, index) => grams !== weighing.weights[index]);
    const events = [
      ...(changed ? [{ id: crypto.randomUUID(), ...envelope, corrects: weighing.weighingId, fact: { type: 'Weighing', weighingRequestId: weighing.weighingRequestId, weights: [...weights], ...(weighing.photos === null ? {} : { photos: [...weighing.photos] }) } }] : []),
      { id: crypto.randomUUID(), ...envelope, fact: { type: 'WeighingValidated', weighingId: weighing.weighingId } },
    ];
    try {
      const answer = await firstValueFrom(this.http.post<{ outcomes: readonly Outcome[] }>('/api/v1/journal/events', { events }, { headers: this.headers() }));
      const refused = answer.outcomes.find((outcome) => outcome.status === 'Refused');
      return refused === undefined ? null : (REFUSALS[refused.refusal?.kind ?? ''] ?? 'Le serveur a refusé cette validation.');
    } catch (error) {
      return problemOf(error);
    }
  }
}

const REFUSALS: Readonly<Record<string, string>> = {
  WeighingAlreadyValidated: 'Pesée déjà validée.',
  UnknownWeighing: 'Cette pesée n’est plus à valider : elle a été annulée.',
  NotFiveWeights: 'Une pesée porte cinq poids.',
  InvalidWeight: 'Un poids est un nombre entier de grammes, au moins 1.',
  CampaignClosed: 'La bande est close.',
};

function problemOf(error: unknown): WeighingProblem {
  const status = typeof error === 'object' && error !== null && 'status' in error ? (error as { status: number }).status : 0;
  return status === 0 ? 'Pas de réseau : cela demande le réseau. Réessaie plus tard.' : 'Le serveur a refusé.';
}
