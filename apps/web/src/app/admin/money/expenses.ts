import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import type { PictogramName } from '@design-system';
import { firstValueFrom } from 'rxjs';
import type { CampaignMoneyView, CostRefusalCode, RecordCostRequest } from '@contracts';
import { clip, number, type PhrasePart } from '../../core/audio/phrase';
import type { ScriptClip } from '../../core/audio/script-clips';
import { fingerprintOf } from '../../core/outbox/media-queue';
import { CLOCK } from '../../core/clock';
import { AuthService } from '../../core/session/auth';
import { OfficeSync, recall, remember } from '../office-sync';

/** What can go wrong with an expense, said in words by the screens. */
export type ExpenseProblem = CostRefusalCode | 'NoType' | 'NoAmount' | 'NoCreditor' | 'NoLot' | 'ReceiptRefused' | 'NoNetwork' | 'ServerError' | 'StorageUnavailable';

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
export function expenseReadBack(category: string, amount: number, paid: boolean | 'byOther'): PhrasePart[] {
  const status = paid === 'byOther' ? 'cost-paid-by-other' : paid ? 'cost-paid' : 'cost-to-pay';
  return [clip(CATEGORY_CLIP[category] ?? 'cost-category-other'), ...amountPhrase(amount), clip(status), clip('confirm')];
}

/**
 * The expenses of a campaign at the office (P.4): its money as the server computes it, and the
 * costs written or corrected — online until the office's queue (P.7). Admin only.
 */
@Injectable()
export class Expenses {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly office = inject(OfficeSync);
  private readonly clock = inject(CLOCK);

  readonly money = signal<CampaignMoneyView | null>(null);
  readonly unreachable = signal(false);
  /** When the figures shown were read; without network, the last reading kept on the device (P.7). */
  readonly readAt = signal<string | null>(null);

  async load(campaignId: string): Promise<void> {
    const url = `/api/v1/campaigns/${campaignId}/money`;
    const session = this.auth.session();
    const userId = session.status === 'none' ? '' : session.userId;
    try {
      const money = await firstValueFrom(this.http.get<CampaignMoneyView>(url, { headers: this.headers() }));
      const at = this.clock.now();
      remember(userId, url, money, at);
      this.money.set(money);
      this.readAt.set(at.toISOString());
      this.unreachable.set(false);
    } catch {
      const kept = recall<CampaignMoneyView>(userId, url);
      if (kept !== null) {
        this.money.set(kept.value);
        this.readAt.set(kept.readAt);
      }
      this.unreachable.set(true);
    }
  }

  /**
   * A cost, or a counter-entry of the cost `corrects` (P.2): kept on the device first, with the
   * instant it was written, and sent when the network allows (P.7). `StorageUnavailable` when the
   * device cannot keep it.
   */
  async save(request: RecordCostRequest, corrects: string | null): Promise<ExpenseProblem | null> {
    const url = corrects === null ? '/api/v1/costs' : `/api/v1/costs/${corrects}/revisions`;
    const kept = await this.office.keep('cost', url, { ...request, recordedAt: request.recordedAt ?? this.clock.now().toISOString() }, request.campaignId);
    return kept ? null : 'StorageUnavailable';
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

}
