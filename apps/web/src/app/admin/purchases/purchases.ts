import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { CounterpartyFaceCode, CounterpartyView, CostTypeView, DraftOrderRequest, OrderRefusalCode, OrderView, PriceCatalogView, RecordPaymentRequest, ReferenceData } from '@contracts';
import { Money, type CurrencyCode } from '@kit';
import { suggestedPrice, type KnownPrice } from '@domain/finance';
import { CLOCK } from '../../core/clock';
import { AuthService } from '../../core/session/auth';
import { OfficeSync, recall, remember } from '../office-sync';
import { currencyWord } from '../typed-number';
import { authHeaders } from '../../core/session/auth-headers';

/** What can go wrong with a purchase, said in words by the screens. */
export type PurchaseProblem = OrderRefusalCode | 'NoSupplier' | 'NoLot' | 'InvalidName' | 'NoNetwork' | 'ServerError' | 'StorageUnavailable';

/**
 * The office's purchases (Q.5): its orders, its suppliers and its orderable cost types, read from
 * the server — online, like the rest of the office (rule 3). Admin only: prices stay here.
 */
@Injectable()
export class Purchases {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly office = inject(OfficeSync);
  private readonly clock = inject(CLOCK);

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
  /** The types a cost is written for (P.4): every type of the farm still in use. */
  readonly activeCostTypes = computed(() => this.costTypes().filter((type) => !type.archived));
  /** Whom a cost may be owed to (P.1): a supplier or a collaborator still in use, never a customer. */
  readonly creditors = computed(() => this.counterparties().filter((counterparty) => counterparty.kind !== 'Customer' && !counterparty.archived));

  /** The prices the farm knows (N.5): paid on orders, or set by hand. Read when an order is written. */
  readonly knownPrices = signal<readonly KnownPrice[]>([]);

  /** Reads the price catalog; without network, no proposal — never a made-up price. */
  async loadPriceCatalog(): Promise<void> {
    try {
      const catalog = await this.get<PriceCatalogView>('/api/v1/price-catalog');
      const currency = catalog.currency as CurrencyCode;
      this.knownPrices.set(
        catalog.prices.flatMap(({ costTypeId, supplierId, unitPrice, at }) => {
          const price = Money.of(unitPrice, currency);
          return price.ok ? [{ costTypeId, supplierId, unitPrice: price.value, at }] : [];
        }),
      );
    } catch {
      this.knownPrices.set([]);
    }
  }

  /** The price known for an article from this supplier (N.5), else from anyone; `null` when none. */
  knownPrice(costTypeId: string, supplierId: string): Money | null {
    return suggestedPrice(this.knownPrices(), costTypeId, supplierId === '' ? null : supplierId);
  }

  /** The price an order proposes for an article from this supplier (N.5), as typed digits; empty when none is known. */
  proposedPrice(costTypeId: string, supplierId: string): string {
    const price = suggestedPrice(this.knownPrices(), costTypeId, supplierId === '' ? null : supplierId);
    return price === null ? '' : String(price.amount);
  }

  /** When the figures shown were read; without network, the last reading kept on the device (P.7). */
  readonly readAt = signal<string | null>(null);

  async load(): Promise<void> {
    const urls = ['/api/v1/orders', '/api/v1/counterparties', '/api/v1/cost-types', '/api/v1/reference-data'] as const;
    const userId = this.userId();
    try {
      const [orders, counterparties, costTypes, referenceData] = await Promise.all([
        this.get<OrderView[]>(urls[0]),
        this.get<CounterpartyView[]>(urls[1]),
        this.get<CostTypeView[]>(urls[2]),
        this.get<ReferenceData>(urls[3]),
      ]);
      const at = this.clock.now();
      [orders, counterparties, costTypes, referenceData].forEach((value, index) => remember(userId, urls[index] ?? '', value, at));
      this.show(orders, counterparties, costTypes, referenceData, at.toISOString());
      this.unreachable.set(false);
    } catch {
      const [orders, counterparties, costTypes, referenceData] = [recall<OrderView[]>(userId, urls[0]), recall<CounterpartyView[]>(userId, urls[1]), recall<CostTypeView[]>(userId, urls[2]), recall<ReferenceData>(userId, urls[3])];
      if (orders !== null && counterparties !== null && costTypes !== null && referenceData !== null) {
        this.show(orders.value, counterparties.value, costTypes.value, referenceData.value, orders.readAt);
      }
      this.unreachable.set(true);
    } finally {
      this.loaded.set(true);
    }
  }

  /** The buyers a sale is made to (W.3): customers still in use. */
  readonly customers = computed(() => this.counterparties().filter((counterparty) => counterparty.kind === 'Customer' && !counterparty.archived));

  /** A supplier created on the spot, while writing an order (decision of 2026-11-09) — or a buyer, while writing a sale (W.3). */
  async createCounterparty(
    name: string,
    face: CounterpartyFaceCode,
    kind: CounterpartyView['kind'] = 'Supplier',
    advancesExpenses = false,
  ): Promise<{ readonly supplier: CounterpartyView } | { readonly problem: PurchaseProblem }> {
    const supplier: CounterpartyView = { id: crypto.randomUUID(), kind, name: name.trim(), face, advancesExpenses, archived: false };
    const problem = await this.send('POST', '/api/v1/counterparties', { id: supplier.id, kind: supplier.kind, name: supplier.name, face, ...(advancesExpenses ? { advancesExpenses } : {}) });
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

  /**
   * A payment of an order (Q.9), kept on the device first and sent when the network allows (P.7);
   * the server keeps it once. `StorageUnavailable` when the device cannot keep it.
   */
  async pay(orderId: string, request: RecordPaymentRequest): Promise<PurchaseProblem | null> {
    return (await this.office.keep('payment', `/api/v1/orders/${orderId}/payments`, { ...request }, orderId)) ? null : 'StorageUnavailable';
  }

  private show(orders: OrderView[], counterparties: CounterpartyView[], costTypes: CostTypeView[], referenceData: ReferenceData, readAt: string): void {
    this.currency.set(referenceData.currency);
    this.orders.set(orders);
    this.counterparties.set(counterparties);
    this.costTypes.set(costTypes);
    this.readAt.set(readAt);
  }

  private userId(): string {
    const session = this.auth.session();
    return session.status === 'none' ? '' : session.userId;
  }

  private headers(): HttpHeaders {
    const session = this.auth.session();
    return authHeaders(session);
  }

  private get<T>(url: string): Promise<T> {
    return firstValueFrom(this.http.get<T>(url, { headers: this.headers() }));
  }

  /** May this counterparty advance money for the farm (R.7)? Kept here as soon as the server took it. */
  async allowAdvances(counterpartyId: string, advancesExpenses: boolean): Promise<PurchaseProblem | null> {
    const problem = await this.send('PATCH', `/api/v1/counterparties/${counterpartyId}`, { advancesExpenses });
    if (problem === null) this.counterparties.update((all) => all.map((one) => (one.id === counterpartyId ? { ...one, advancesExpenses } : one)));
    return problem;
  }

  private async send(method: 'POST' | 'PUT' | 'PATCH', url: string, body: unknown): Promise<PurchaseProblem | null> {
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

/** An amount said the way it is read: « 925 000 FCFA » (decision of the founder, 2026-11-13). The currency comes from the order, never written in the screen. */
export function amountWords(amount: number, currency: string): string {
  const figures = String(Math.trunc(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${figures} ${currencyWord(currency)}`;
}
