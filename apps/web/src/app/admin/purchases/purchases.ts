import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { CounterpartyFaceCode, CounterpartyView, CostTypeView, DraftOrderRequest, OrderRefusalCode, OrderView, RecordPaymentRequest, ReferenceData } from '@contracts';
import { AuthService } from '../../core/session/auth';

/** What can go wrong with a purchase, said in words by the screens. */
export type PurchaseProblem = OrderRefusalCode | 'NoSupplier' | 'NoLot' | 'InvalidName' | 'NoNetwork' | 'ServerError';

/**
 * The office's purchases (Q.5): its orders, its suppliers and its orderable cost types, read from
 * the server — online, like the rest of the office (rule 3). Admin only: prices stay here.
 */
@Injectable()
export class Purchases {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  readonly orders = signal<readonly OrderView[]>([]);
  private readonly counterparties = signal<readonly CounterpartyView[]>([]);
  private readonly costTypes = signal<readonly CostTypeView[]>([]);
  /** The farm's currency, read from the server: never written in the screens (rule 7). */
  readonly currency = signal<string | null>(null);
  readonly loaded = signal(false);
  /** The last reading did not come. */
  readonly unreachable = signal(false);

  /** The suppliers one can order from: archived ones are no longer offered. */
  readonly suppliers = computed(() => this.counterparties().filter((counterparty) => counterparty.kind === 'Supplier' && !counterparty.archived));
  /** The types one can order: orderable and not archived. */
  readonly orderableTypes = computed(() => this.costTypes().filter((type) => type.orderable && !type.archived));
  /** Every counterparty and type by its id, archived ones included: an old order still reads its names. */
  readonly counterpartyById = computed(() => new Map(this.counterparties().map((counterparty) => [counterparty.id, counterparty])));
  readonly costTypeById = computed(() => new Map(this.costTypes().map((type) => [type.id, type])));

  async load(): Promise<void> {
    try {
      const [orders, counterparties, costTypes, referenceData] = await Promise.all([
        this.get<OrderView[]>('/api/v1/orders'),
        this.get<CounterpartyView[]>('/api/v1/counterparties'),
        this.get<CostTypeView[]>('/api/v1/cost-types'),
        this.get<ReferenceData>('/api/v1/reference-data'),
      ]);
      this.currency.set(referenceData.currency);
      this.orders.set(orders);
      this.counterparties.set(counterparties);
      this.costTypes.set(costTypes);
      this.unreachable.set(false);
    } catch {
      this.unreachable.set(true);
    } finally {
      this.loaded.set(true);
    }
  }

  /** A supplier created on the spot, while writing an order (decision of 2026-11-09). */
  async createSupplier(name: string, face: CounterpartyFaceCode): Promise<{ readonly supplier: CounterpartyView } | { readonly problem: PurchaseProblem }> {
    const supplier: CounterpartyView = { id: crypto.randomUUID(), kind: 'Supplier', name: name.trim(), face, archived: false };
    const problem = await this.send('POST', '/api/v1/counterparties', { id: supplier.id, kind: supplier.kind, name: supplier.name, face });
    if (problem !== null) return { problem };
    this.counterparties.update((all) => [...all, supplier]);
    return { supplier };
  }

  /** Writes a new draft, or rewrites an existing one. The list reads itself again when it opens. */
  saveDraft(request: DraftOrderRequest, isNew: boolean): Promise<PurchaseProblem | null> {
    return this.send(isNew ? 'POST' : 'PUT', isNew ? '/api/v1/orders' : `/api/v1/orders/${request.id}`, request);
  }

  /** One gesture: the draft goes to the caretaker of its site. */
  async announce(orderId: string): Promise<PurchaseProblem | null> {
    const problem = await this.send('POST', `/api/v1/orders/${orderId}/announce`, {});
    if (problem === null) await this.load();
    return problem;
  }

  /** A payment of an order (Q.9). Sent again with the same identifier, the server keeps it once. */
  pay(orderId: string, request: RecordPaymentRequest): Promise<PurchaseProblem | null> {
    return this.send('POST', `/api/v1/orders/${orderId}/payments`, request);
  }

  private headers(): HttpHeaders {
    const session = this.auth.session();
    return new HttpHeaders(session.status === 'none' ? {} : { Authorization: `Bearer ${session.token}` });
  }

  private get<T>(url: string): Promise<T> {
    return firstValueFrom(this.http.get<T>(url, { headers: this.headers() }));
  }

  private async send(method: 'POST' | 'PUT', url: string, body: unknown): Promise<PurchaseProblem | null> {
    try {
      await firstValueFrom(this.http.request(method, url, { body, headers: this.headers() }));
      return null;
    } catch (error) {
      if (!(error instanceof HttpErrorResponse) || error.status === 0) return 'NoNetwork';
      const kind = (error.error as { kind?: unknown } | null)?.kind;
      return typeof kind === 'string' ? (kind as PurchaseProblem) : 'ServerError';
    }
  }
}

/** An amount said the way it is read: « 925 000 F ». The currency comes from the order, never written in the screen. */
export function amountWords(amount: number, currency: string): string {
  const figures = String(Math.trunc(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${figures} ${currency === 'XOF' ? 'F' : currency}`;
}
