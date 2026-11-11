import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { PictogramName } from '@design-system';
import type { OrderStatusCode, OrderView } from '@contracts';
import { orderedAmount } from '@domain/finance';
import type { CurrencyCode } from '@kit';
import { Pictogram } from '../../ui/pictogram';
import { Office } from '../office';
import { amountWords, Purchases, type PurchaseProblem } from './purchases';

/** Each state with its picture, its colour and its word: three channels (CdC « Un bureau pour ceux qui ne lisent pas »). */
const STATUS: Record<OrderStatusCode, { readonly picto: PictogramName; readonly tone: string; readonly words: string }> = {
  Draft: { picto: 'pencil', tone: 'draft', words: 'Brouillon' },
  Announced: { picto: 'truck', tone: 'announced', words: 'Annoncée au gardien' },
  PartiallyReceived: { picto: 'received-bags', tone: 'partial', words: 'En partie reçue' },
  Received: { picto: 'round-check', tone: 'received', words: 'Reçue' },
  Closed: { picto: 'cross', tone: 'closed', words: 'Close' },
  Settled: { picto: 'stamp-done', tone: 'settled', words: 'Soldée' },
};

// « Achats » (Q.5): every order of the farm, with its supplier, its lot, its state and its money;
// a draft is announced to the caretaker in one gesture. Online, like the rest of the office.
@Component({
  selector: 'app-purchases-page',
  imports: [Pictogram, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1><app-pictogram picto="truck" [decorative]="true" /> Commandes</h1>
    <a class="new-order" routerLink="nouvelle"><app-pictogram picto="pencil" [decorative]="true" /> Nouvelle commande</a>
    @if (purchases.unreachable()) {
      <p class="refusal" role="alert"><app-pictogram picto="sync-cloud" [decorative]="true" /> Pas de réseau : les commandes ne se lisent pas.</p>
    }
    @if (problem(); as problem) {
      <p class="refusal" role="alert"><app-pictogram picto="cross" [decorative]="true" /> {{ problem }}</p>
    }
    @if (purchases.loaded() && cards().length === 0 && !purchases.unreachable()) {
      <p class="none"><app-pictogram picto="truck" [decorative]="true" /> Aucune commande pour l’instant.</p>
    }
    <ul>
      @for (card of cards(); track card.order.id) {
        <li class="order" [class]="'tone-' + card.status.tone">
          <a class="open" [routerLink]="card.order.status === 'Draft' ? card.order.id : null">
            <app-pictogram class="face" [picto]="card.face" [decorative]="true" />
            <span class="who">{{ card.supplier }}</span>
            <span class="lot">{{ card.lot }}</span>
            <span class="status"><app-pictogram [picto]="card.status.picto" [decorative]="true" /> {{ card.status.words }}</span>
            <span class="money">{{ card.money }}</span>
          </a>
          <div class="acts">
            @if (card.order.status === 'Draft') {
              <button type="button" class="announce" [disabled]="announcing() === card.order.id" (click)="announce(card.order.id)">
                <app-pictogram picto="truck" [decorative]="true" /> Annoncer au gardien
              </button>
            }
            <a class="pay" [routerLink]="[card.order.id, 'payer']"><app-pictogram picto="coin" [decorative]="true" /> Payer</a>
          </div>
        </li>
      }
    </ul>
  `,
  styles: `
    :host { display: block; }
    h1 { display: flex; align-items: center; gap: 8px; margin: 0 0 12px; font: 700 1.35rem var(--font-hand); color: var(--color-earth); }
    h1 app-pictogram { inline-size: 36px; block-size: 36px; }
    .new-order {
      display: flex; align-items: center; justify-content: center; gap: 8px; min-block-size: 56px; margin-block-end: 14px;
      border: 3px solid var(--color-ink); border-radius: var(--radius-wobble-1); box-shadow: var(--shadow-hard);
      background: var(--color-pasture); color: var(--color-on-sign); font: 700 1.1rem var(--font-hand); text-decoration: none;
    }
    .new-order app-pictogram { inline-size: 26px; block-size: 26px; }
    .new-order:focus-visible, .open:focus-visible, .announce:focus-visible { outline: 4px solid var(--color-blue); outline-offset: 2px; }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
    .order {
      background: var(--color-shell); border: 2px solid var(--color-card-edge); border-inline-start-width: 6px; border-radius: var(--radius-wobble-2);
      box-shadow: var(--shadow-hard-sm); overflow: hidden;
    }
    .open {
      display: grid; grid-template-columns: 44px 1fr; grid-template-areas: 'face who' 'face lot' 'status status' 'money money';
      column-gap: 12px; row-gap: 4px; padding: 12px 14px; color: var(--color-ink); text-decoration: none;
    }
    .face { grid-area: face; inline-size: 44px; block-size: 44px; align-self: center; }
    .who { grid-area: who; font: 700 1.05rem var(--font-hand); color: var(--color-earth); }
    .lot { grid-area: lot; color: var(--color-muted); }
    .status { grid-area: status; display: flex; align-items: center; gap: 6px; font-weight: 700; margin-block-start: 4px; }
    .status app-pictogram { inline-size: 22px; block-size: 22px; }
    .money { grid-area: money; font-variant-numeric: tabular-nums; }
    .tone-draft { border-inline-start-color: var(--color-neutral); }
    .tone-announced { border-inline-start-color: var(--color-blue); }
    .tone-partial { border-inline-start-color: var(--color-orange); }
    .tone-received, .tone-settled { border-inline-start-color: var(--color-pasture); }
    .tone-closed { border-inline-start-color: var(--color-muted); }
    .acts { display: flex; border-block-start: 2px dashed var(--color-card-edge); }
    .announce, .pay {
      flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px; min-block-size: 52px;
      border: 0; background: var(--color-paper); color: var(--color-ink); font: 700 1rem var(--font-hand); text-decoration: none;
    }
    .announce + .pay { border-inline-start: 2px dashed var(--color-card-edge); }
    .announce app-pictogram, .pay app-pictogram { inline-size: 24px; block-size: 24px; }
    .pay:focus-visible { outline: 4px solid var(--color-blue); outline-offset: -4px; }
    .announce:disabled { opacity: 0.6; }
    .none, .refusal { display: flex; align-items: center; gap: 10px; margin: 0 0 12px; }
    .none { color: var(--color-muted); font-style: italic; }
    .none app-pictogram, .refusal app-pictogram { inline-size: 26px; block-size: 26px; flex: none; }
    .refusal { padding: 10px 12px; border-inline-start: 5px solid var(--color-alert); background: var(--color-alert-light); color: var(--color-alert); font-weight: 700; }
  `,
})
export class PurchasesPage {
  protected readonly purchases = inject(Purchases);
  private readonly office = inject(Office);
  protected readonly announcing = signal<string | null>(null);
  protected readonly problem = signal<string | null>(null);

  protected readonly cards = computed(() =>
    this.purchases.orders().map((order) => {
      const supplier = this.purchases.counterpartyById().get(order.supplierId);
      const lot = this.office.lots().find((one) => one.campaignId === order.campaignId);
      return {
        order,
        supplier: supplier?.name ?? 'Fournisseur',
        face: (supplier?.face ?? 'paper') as PictogramName,
        lot: lot === undefined ? 'Bande close' : `${lot.siteName} · Jour ${lot.campaignDay}`,
        status: STATUS[order.status],
        money: moneyOf(order),
      };
    }),
  );

  constructor() {
    void this.purchases.load();
  }

  protected async announce(orderId: string): Promise<void> {
    this.announcing.set(orderId);
    const problem = await this.purchases.announce(orderId);
    this.announcing.set(null);
    this.problem.set(problem === null ? null : wordsOf(problem));
  }
}

// Before anything is received: what was ordered. Then: what is to be paid, and what was paid.
function moneyOf(order: OrderView): string {
  if (order.status === 'Draft' || order.status === 'Announced') {
    const ordered = orderedAmount(order.lines, order.currency as CurrencyCode);
    return ordered.ok ? `${amountWords(ordered.value.amount, order.currency)} commandés` : '';
  }
  const paid = order.paid === 0 ? 'rien payé' : `payé ${amountWords(order.paid, order.currency)}`;
  return `${amountWords(order.billable, order.currency)} à payer · ${paid}`;
}

function wordsOf(problem: PurchaseProblem): string {
  return problem === 'NoNetwork' ? 'Pas de réseau : la commande n’est pas annoncée. Réessaie avec le réseau.' : 'Le serveur n’a pas pu annoncer la commande. Réessaie.';
}
