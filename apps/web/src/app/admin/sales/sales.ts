import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { RecordSaleRequest, SaleReceiptRequest, SaleRefusalCode, SalesView } from '@contracts';
import { CLOCK } from '../../core/clock';
import { AuthService } from '../../core/session/auth';
import { OfficeSync, recall, remember } from '../office-sync';

export type SaleProblem = SaleRefusalCode | 'NoBuyer' | 'NoBirds' | 'NoPrice' | 'NoMethod' | 'NoLot' | 'StorageUnavailable';

/**
 * The sales of a lot at the office (W.3): their money as the server computes it — the screen adds
 * nothing up —, and the sales and receipts written, kept first on the device (P.7).
 */
@Injectable()
export class Sales {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly office = inject(OfficeSync);
  private readonly clock = inject(CLOCK);

  readonly view = signal<SalesView | null>(null);
  readonly unreachable = signal(false);
  readonly readAt = signal<string | null>(null);

  async load(campaignId: string): Promise<void> {
    const url = `/api/v1/campaigns/${campaignId}/sales`;
    const session = this.auth.session();
    const userId = session.status === 'none' ? '' : session.userId;
    try {
      const view = await firstValueFrom(this.http.get<SalesView>(url, { headers: new HttpHeaders(session.status === 'none' ? {} : { Authorization: `Bearer ${session.token}` }) }));
      const at = this.clock.now();
      remember(userId, url, view, at);
      this.view.set(view);
      this.readAt.set(at.toISOString());
      this.unreachable.set(false);
    } catch {
      const kept = recall<SalesView>(userId, url);
      if (kept !== null) {
        this.view.set(kept.value);
        this.readAt.set(kept.readAt);
      }
      this.unreachable.set(true);
    }
  }

  /** A sale, with what was paid on the spot: kept on the device, sent when the network allows. */
  async record(request: RecordSaleRequest): Promise<SaleProblem | null> {
    return (await this.office.keep('sale', '/api/v1/sales', { ...request }, request.campaignId)) ? null : 'StorageUnavailable';
  }

  /** Money received later for a sale. */
  async receive(saleId: string, campaignId: string, request: SaleReceiptRequest): Promise<SaleProblem | null> {
    return (await this.office.keep('saleReceipt', `/api/v1/sales/${saleId}/receipts`, { ...request }, campaignId)) ? null : 'StorageUnavailable';
  }
}
