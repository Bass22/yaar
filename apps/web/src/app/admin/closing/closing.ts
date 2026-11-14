import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { CampaignClosingRefusal, ClosedLotView, CloseCampaignRequest, ClosingReportView, CostTypeView } from '@contracts';
import { AuthService } from '../../core/session/auth';
import { authHeaders } from '../../core/session/auth-headers';

const REFUSALS: Record<CampaignClosingRefusal['kind'], string> = {
  InvalidRequest: 'La demande est mal formée.',
  CampaignNotFound: 'Cette bande est introuvable.',
  CampaignClosed: 'Cette bande est déjà close.',
  UnknownCostType: 'Un type de reste est inconnu.',
  NotALeftover: 'Des animaux ne sont pas un reste.',
  InvalidQuantity: 'Un nombre entier de sacs ou d’unités, jamais négatif.',
  EmptyLeftover: 'Une ligne de reste est vide.',
  DuplicateType: 'Un type est saisi deux fois.',
  InvalidId: 'Un identifiant est mal formé.',
  LeftoversWithoutReceiver: 'Choisis la bande qui reçoit les restes.',
  UnknownReceiver: 'La bande qui reçoit les restes est introuvable.',
  SameCampaign: 'Les restes vont à une autre bande que celle qu’on clôt.',
  OtherSite: 'Les restes vont à une bande du même site.',
  DestinationClosed: 'La bande qui reçoit les restes est déjà close.',
  CommentTooLong: 'Le commentaire dépasse 2 000 caractères.',
  InvalidOpenedWeight: 'Les kg restants : un nombre entier au-dessus de zéro, pour un sac d’aliment entamé.',
  UnexplainedFeedGap: 'Les sacs d’aliment comptés ne tombent pas juste.',
};

/** Why a closing was refused: the words, and for the bags of feed, the gap the server found (N.8d). */
export type ClosingRefused = { readonly words: string; readonly feedGap?: { readonly expected: number; readonly counted: number; readonly gap: number } };

/**
 * Closing a campaign at the office (X.2): online only — the closing, its report and the closed
 * lots are read from the server, nothing is kept for offline.
 */
@Injectable()
export class Closing {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  private readonly costTypes = signal<readonly CostTypeView[]>([]);
  /** What can be left (X.1): what is ordered, not archived, never the chicks. */
  readonly leftoverTypes = computed(() => this.costTypes().filter((type) => type.orderable && !type.archived && type.category !== 'Chicks'));

  async loadCostTypes(): Promise<void> {
    try {
      this.costTypes.set(await firstValueFrom(this.http.get<CostTypeView[]>('/api/v1/cost-types', { headers: this.headers() })));
    } catch {
      this.costTypes.set([]);
    }
  }

  /** `null` when closed; otherwise what to tell the admin. */
  async close(campaignId: string, request: CloseCampaignRequest): Promise<ClosingRefused | null> {
    try {
      await firstValueFrom(this.http.post(`/api/v1/campaigns/${campaignId}/closing`, request, { headers: this.headers() }));
      return null;
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status >= 400 && error.status < 500) {
        const refusal = error.error as Partial<CampaignClosingRefusal> | null;
        const words = (refusal?.kind === undefined ? undefined : REFUSALS[refusal.kind]) ?? 'La clôture est refusée.';
        return refusal?.kind === 'UnexplainedFeedGap' && 'gap' in refusal ? { words, feedGap: { expected: refusal.expected ?? 0, counted: refusal.counted ?? 0, gap: refusal.gap ?? 0 } } : { words };
      }
      return { words: 'Pas de réseau : la clôture demande le réseau. Réessaie plus tard.' };
    }
  }

  async report(campaignId: string): Promise<ClosingReportView | null> {
    try {
      return await firstValueFrom(this.http.get<ClosingReportView>(`/api/v1/campaigns/${campaignId}/closing-report`, { headers: this.headers() }));
    } catch {
      return null;
    }
  }

  async closedLots(): Promise<ClosedLotView[] | null> {
    try {
      return await firstValueFrom(this.http.get<ClosedLotView[]>('/api/v1/campaigns/closed', { headers: this.headers() }));
    } catch {
      return null;
    }
  }

  private headers(): HttpHeaders {
    const session = this.auth.session();
    return authHeaders(session);
  }
}

/** `2026-11-01` → « 01/11/2026 ». */
