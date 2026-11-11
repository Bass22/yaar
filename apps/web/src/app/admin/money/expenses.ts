import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import type { PictogramName } from '@design-system';
import { firstValueFrom } from 'rxjs';
import type { CampaignMoneyView, CostRefusalCode, RecordCostRequest } from '@contracts';
import { clip, number, type PhrasePart } from '../../core/audio/phrase';
import type { ScriptClip } from '../../core/audio/script-clips';
import { fingerprintOf } from '../../core/outbox/media-queue';
import { AuthService } from '../../core/session/auth';

/** What can go wrong with an expense, said in words by the screens. */
export type ExpenseProblem = CostRefusalCode | 'NoType' | 'NoAmount' | 'NoCreditor' | 'NoLot' | 'ReceiptRefused' | 'NoNetwork' | 'ServerError';

/** The real object of each category of the base: what the admin recognises without reading (screen 7). To check in the field where marked. */
export const CATEGORY_PICTO: Record<string, PictogramName> = {
  Feed: 'closed-bag',
  Chicks: 'chick',
  Health: 'syringe',
  Bedding: 'received-bags',
  Labour: 'caretaker',
  Equipment: 'barn',
  Cleaning: 'drinker',
  Transport: 'truck',
  Processing: 'hen',
  Utilities: 'drinker',
  FinancialCharges: 'coin',
  Other: 'paper',
};

const CATEGORY_CLIP: Record<string, ScriptClip> = {
  Feed: 'cost-category-feed',
  Chicks: 'cost-category-chicks',
  Health: 'cost-category-health',
  Bedding: 'cost-category-bedding',
  Labour: 'cost-category-labour',
  Equipment: 'cost-category-equipment',
  Cleaning: 'cost-category-cleaning',
  Transport: 'cost-category-transport',
  Processing: 'cost-category-processing',
  Utilities: 'cost-category-utilities',
  FinancialCharges: 'cost-category-financial-charges',
  Other: 'cost-category-other',
};

/** « Montant : quarante-deux mille francs. » */
export const amountPhrase = (amount: number): PhrasePart[] => [clip('money-amount'), number(amount), clip('money-francs')];

/** The read-back before the Oui of an expense (screen 9): what for, how much, paid or owed. */
export function expenseReadBack(category: string, amount: number, paid: boolean): PhrasePart[] {
  return [clip(CATEGORY_CLIP[category] ?? 'cost-category-other'), ...amountPhrase(amount), clip(paid ? 'cost-paid' : 'cost-to-pay'), clip('confirm')];
}

/**
 * The expenses of a campaign at the office (P.4): its money as the server computes it, and the
 * costs written or corrected — online until the office's queue (P.7). Admin only.
 */
@Injectable()
export class Expenses {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  readonly money = signal<CampaignMoneyView | null>(null);
  readonly unreachable = signal(false);

  async load(campaignId: string): Promise<void> {
    try {
      this.money.set(await firstValueFrom(this.http.get<CampaignMoneyView>(`/api/v1/campaigns/${campaignId}/money`, { headers: this.headers() })));
      this.unreachable.set(false);
    } catch {
      this.unreachable.set(true);
    }
  }

  /** A cost, or a counter-entry of the cost `corrects` (P.2): the cost written again whole. */
  save(request: RecordCostRequest, corrects: string | null): Promise<ExpenseProblem | null> {
    return this.send(corrects === null ? '/api/v1/costs' : `/api/v1/costs/${corrects}/revisions`, request);
  }

  /** The receipt's photo, sent first to the media store (M.1) as a supporting document; its fingerprint, or why not. */
  async sendReceipt(bytes: Uint8Array): Promise<{ readonly fingerprint: string } | { readonly problem: ExpenseProblem }> {
    const fingerprint = await fingerprintOf(bytes);
    try {
      await firstValueFrom(
        this.http.put(`/api/v1/media/${fingerprint}`, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }), {
          params: { retention: 'SupportingDocument' },
          headers: this.headers().set('Content-Type', 'image/jpeg'),
        }),
      );
      return { fingerprint };
    } catch (error) {
      if (!(error instanceof HttpErrorResponse) || error.status === 0) return { problem: 'NoNetwork' };
      return { problem: error.status >= 500 ? 'ServerError' : 'ReceiptRefused' };
    }
  }

  private headers(): HttpHeaders {
    const session = this.auth.session();
    return new HttpHeaders(session.status === 'none' ? {} : { Authorization: `Bearer ${session.token}` });
  }

  private async send(url: string, body: unknown): Promise<ExpenseProblem | null> {
    try {
      await firstValueFrom(this.http.post(url, body, { headers: this.headers() }));
      return null;
    } catch (error) {
      if (!(error instanceof HttpErrorResponse) || error.status === 0) return 'NoNetwork';
      const kind = (error.error as { kind?: unknown } | null)?.kind;
      return typeof kind === 'string' ? (kind as ExpenseProblem) : 'ServerError';
    }
  }
}
