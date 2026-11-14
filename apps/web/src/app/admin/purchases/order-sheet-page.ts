import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { PaymentMethodCode } from '@contracts';
import { byTheBag, lineDelivery, type Quantity } from '@domain/journal';
import { Pictogram } from '../../ui/pictogram';

import { FiguresAge } from '../figures-age';
import { PhotosComponent } from '../photos';
import { currencyWord, dayWords, grouped } from '../typed-number';
import { amountWords, Purchases } from './purchases';
import { OrderReceptions } from './order-receptions';
import { ORDER_STATUS } from './purchases-page';
import { orderedAmount } from '@domain/finance';
import type { CurrencyCode } from '@kit';

const METHOD: Record<PaymentMethodCode, string> = { Cash: 'en espèces', Wave: 'par Wave', OrangeMoney: 'par Orange Money' };

/** « 20 sacs », « 1 poussin », « 3 unités ». */
const counted = (count: number, category: string | undefined): string => {
  const [one, many] = byTheBag(category ?? '') ? ['sac', 'sacs'] : category === 'Chicks' ? ['poussin', 'poussins'] : ['unité', 'unités'];
  return `${grouped(count)} ${count > 1 ? many : one}`;
};

// Reading an order (Q.12; demand of the founder, 2026-11-13): any order, announced or closed, opens
// to say what was ordered, at what price, what came and what is left, and who paid. Nothing changes
// here: a draft is changed in the editor, a payment written from « Payer ».
@Component({
  selector: 'app-order-sheet-page',
  imports: [FiguresAge, OrderReceptions, PhotosComponent, Pictogram, RouterLink],
  providers: [Purchases],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="back" routerLink="../..">Revenir aux achats</a>
    <app-figures-age [readAt]="purchases.readAt()" [stale]="purchases.unreachable()" />
    @if (order(); as order) {
      <header class="sheet-head">
        <h1><app-pictogram [picto]="status(order.status).picto" [decorative]="true" /> {{ supplierName(order.supplierId) }}</h1>
        <p>Commandée le {{ day(order.orderDay) }}@if (order.reference !== null) {&ngsp;· {{ order.reference }}} · {{ status(order.status).words }}</p>
      </header>
      <ul class="lines">
        @for (line of order.lines; track line.id) {
          <li class="sheet-line">
            <b class="name">{{ typeName(line.costTypeId) }}</b>&ngsp;
            <span class="figures">{{ counted(line.quantity, category(line.costTypeId)) }} × {{ money(line.unitPrice, order.currency) }} = {{ money(line.quantity * line.unitPrice, order.currency) }}</span>&ngsp;
            @if (line.bagWeight !== null) {
              <span class="bag">sac de {{ grouped(line.bagWeight / 1000) }} kg</span>&ngsp;
            }
            <span class="delivery">
              reçu {{ grouped(line.received) }}
              @if (delivery(line.quantity, line.received); as state) {
                @if (state.remaining > 0) {
                  &ngsp;reste {{ grouped(state.remaining) }}
                } @else if (state.variance > 0) {
                  &ngsp;<b class="bonus">+{{ grouped(state.variance) }}</b>
                }
              }
            </span>
          </li>
        }
      </ul>
      <p class="sheet-total">Commandé <b>{{ money(ordered(), order.currency) }}</b></p>
      <!-- The photos of the order: the invoice, the order form (R.6) — joined at the time or later -->
      <div class="order-photos">
        <h2><app-pictogram picto="camera" [decorative]="true" /> Justificatifs</h2>
        <app-photos [photos]="order.attachments" [subject]="{ kind: 'Order', id: order.id }" label="Facture" (joined)="reload()" />
      </div>
      <!-- A draft: one or the other (Q.15) — the whole order at once, or receptions declared one by one -->
      @if (order.status === 'Draft') {
        <div class="sheet-modes">
          <button type="button" class="announce" [disabled]="announcing()" (click)="announce(order.id)"><app-pictogram picto="truck" [decorative]="true" /> Prévenir le gardien</button>
        </div>
      }
      <!-- Only an order still waiting for goods has receptions to plan (Q.14); declaring the first announces a draft (Q.15) -->
      @if (order.status === 'Draft' || order.status === 'Announced' || order.status === 'PartiallyReceived') {
        <app-order-receptions [order]="order" [startOpen]="declaring" />
      }
      @if (order.payments.length > 0) {
        <h2><app-pictogram picto="coin" [decorative]="true" /> Les paiements</h2>
        <ul class="payments">
          @for (payment of order.payments; track payment.id) {
            <li class="sheet-payment">
              <span class="payment-words">{{ day(payment.paidOn) }} <b>{{ money(payment.amount, order.currency) }}</b> {{ method[payment.method] }}@if (payment.paidBy !== null) {, payé par {{ supplierName(payment.paidBy) }}}</span>&ngsp;
              <app-photos [photos]="payment.attachments" [subject]="{ kind: 'Payment', id: payment.id }" label="Reçu" (joined)="reload()" />
            </li>
          }
        </ul>
      }
      <a class="pay" [routerLink]="['..', 'payer']"><app-pictogram picto="coin" [decorative]="true" /> Payer</a>
    } @else if (purchases.loaded()) {
      <p class="missing" role="alert">Cette commande est introuvable.</p>
    }
  `,
  styles: `
    .sheet-modes { display: flex; flex-wrap: wrap; gap: 8px; margin-block: 10px; }
    .sheet-modes .announce { display: inline-flex; align-items: center; gap: 8px; min-block-size: 48px; padding: 0 14px; border: 2px solid var(--color-ink); border-radius: var(--radius-wobble-1); background: var(--color-blue); color: var(--color-on-sign); font-weight: 700; cursor: pointer; }
    .sheet-modes app-pictogram { inline-size: 24px; block-size: 24px; }
    .sheet-modes .announce:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }

    :host { display: block; }
    .back { display: inline-flex; align-items: center; min-block-size: 44px; color: var(--color-ink); font-weight: 700; }
    .sheet-head h1 { display: flex; align-items: center; gap: 8px; margin: 0; font: 700 1.35rem var(--font-hand); color: var(--color-earth); }
    .sheet-head h1 app-pictogram { inline-size: 32px; block-size: 32px; }
    .sheet-head p { margin: 2px 0 10px; color: var(--color-muted); }
    ul { list-style: none; margin: 0; padding: 0; }
    .sheet-line { display: flex; flex-wrap: wrap; gap: 4px 10px; padding: 10px 12px; margin-block-end: 8px; background: var(--color-shell); border: 2px solid var(--color-card-edge); border-radius: var(--radius-wobble-2); box-shadow: var(--shadow-hard-sm); }
    .sheet-line .name { flex-basis: 100%; font: 700 1.1rem var(--font-hand); color: var(--color-ink); }
    .figures { font-variant-numeric: tabular-nums; color: var(--color-ink); }
    .bag, .delivery { color: var(--color-muted); }
    .bonus { color: var(--color-pasture); }
    .sheet-total { margin: 8px 0; font-size: 1.05rem; color: var(--color-ink); }
    h2 { display: flex; align-items: center; gap: 8px; margin: 14px 0 6px; font: 700 1.1rem var(--font-hand); color: var(--color-earth); }
    h2 app-pictogram { inline-size: 26px; block-size: 26px; }
    .sheet-payment { display: grid; gap: 6px; padding: 6px 0; border-block-end: 1px dashed var(--color-card-edge); color: var(--color-ink); }
    .sheet-payment app-photos { justify-self: start; }
    .order-photos { margin-block: 10px; }
    .pay { display: inline-flex; align-items: center; gap: 6px; min-block-size: 48px; margin-block-start: 12px; padding: 0 16px; border: 2px solid var(--color-ink); border-radius: var(--radius-wobble-1); background: var(--color-pasture); color: var(--color-on-sign); font-weight: 700; text-decoration: none; }
    .pay app-pictogram { inline-size: 24px; block-size: 24px; }
    .missing { color: var(--color-alert); font-weight: 700; }
    a:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }
  `,
})
export class OrderSheetPage {
  protected readonly purchases = inject(Purchases);
  private readonly route = inject(ActivatedRoute);
  private readonly orderId = this.route.snapshot.paramMap.get('id') ?? '';

  protected readonly order = computed(() => this.purchases.orders().find((order) => order.id === this.orderId) ?? null);
  protected readonly ordered = computed(() => {
    const order = this.order();
    const total = order === null ? null : orderedAmount(order.lines, order.currency as CurrencyCode);
    return total?.ok ? total.value.amount : 0;
  });
  protected readonly method = METHOD;
  protected readonly grouped = grouped;
  protected readonly counted = counted;

  /** Came from « Déclarer des réceptions »: the form of the first reception is open (Q.15). */
  protected readonly declaring = this.route.snapshot.queryParamMap.get('receptions') === 'declarer';
  protected readonly announcing = signal(false);

  constructor() {
    void this.purchases.load();
  }

  /** « Prévenir le gardien »: the whole order at once (Q.15). */
  protected async announce(orderId: string): Promise<void> {
    this.announcing.set(true);
    await this.purchases.announce(orderId);
    this.announcing.set(false);
  }

  protected reload(): void {
    void this.purchases.load();
  }

  protected status(code: keyof typeof ORDER_STATUS) {
    return ORDER_STATUS[code];
  }

  protected supplierName(id: string): string {
    return this.purchases.counterpartyById().get(id)?.name ?? '';
  }

  protected typeName(id: string): string {
    return this.purchases.costTypeById().get(id)?.name ?? '';
  }

  protected category(id: string): string | undefined {
    return this.purchases.costTypeById().get(id)?.category;
  }

  protected delivery(ordered: number, received: number) {
    return lineDelivery(ordered as Quantity, received);
  }

  protected day(day: string): string {
    return dayWords(day);
  }

  protected money(amount: number, currency: string): string {
    return amountWords(amount, currency);
  }

  protected readonly currencyWord = currencyWord;
}
