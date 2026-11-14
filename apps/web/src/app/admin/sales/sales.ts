import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import type { RecordSaleRequest, SaleReceiptRequest, SaleRefusalCode, SalesView } from '@contracts';
import { CLOCK } from '../../core/clock';
import { AuthService } from '../../core/session/auth';
import { OfficeSync, readOrRecall } from '../office-sync';
import { authHeaders } from '../../core/session/auth-headers';

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
    await readOrRecall<SalesView>(this.http, url, userId, authHeaders(session), () => this.clock.now(), (reading, online) => {
      if (reading !== null) {
        this.view.set(reading.value);
        this.readAt.set(reading.readAt);
      }
      this.unreachable.set(!online);
    });
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
