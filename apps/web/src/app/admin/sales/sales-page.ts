import { ChangeDetectionStrategy, Component, computed, effect, inject, untracked } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { PictogramName } from '@design-system';
import type { SaleView } from '@contracts';
import { clip, number, type PhrasePart } from '../../core/audio/phrase';
import { Pictogram } from '../../ui/pictogram';
import { SpeakerButton } from '../../ui/speaker-button';
import { FiguresAge } from '../figures-age';
import { Office } from '../office';
import { OfficePending } from '../office-pending';
import { OfficeSync } from '../office-sync';
import { amountWords, Purchases } from '../purchases/purchases';
import { Sales } from './sales';
import { CurrentLot, currentLotOf } from '../lots/current-lot';
import { dayWords } from '../typed-number';

// The sales of a lot (W.3; CdC « Les ventes »): the money of the sales computed by the server —
// revenue, cashed in, the live margin (cashed in − committed), the average price a bird and what
// is left to sell —, then each sale: its buyer, its day, its birds, its amount, what is still owed.
// Before the first sale, margin and average price are absent, never zero.
@Component({
  selector: 'app-sales-page',
  imports: [CurrentLot, FiguresAge, OfficePending, Pictogram, RouterLink, SpeakerButton],
  providers: [Sales],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1><app-pictogram picto="hen" [decorative]="true" /> Ventes</h1>
    <a class="back" routerLink="..">Revenir aux lots</a>
    <app-current-lot />
    <app-figures-age [readAt]="sales.readAt()" [stale]="sales.unreachable()" />
    <app-office-pending [kinds]="['sale', 'saleReceipt']" [subject]="lotId()" />
    @if (sales.view(); as view) {
      <section class="figures" aria-label="L'argent des ventes">
        <div class="figure margin" [class.minus]="(view.margin ?? 0) < 0">
          <span>Marge en direct</span>&ngsp;<strong>{{ view.margin === null ? 'pas encore' : signed(view.margin) }}</strong>
          <app-speaker-button [phrase]="marginPhrase()" label="Écouter la marge" />
        </div>
        <div class="figure"><span>Ventes</span>&ngsp;<strong>{{ money(view.revenue) }}</strong></div>
        <div class="figure"><span>Encaissé</span>&ngsp;<strong>{{ money(view.cashedIn) }}</strong></div>
        <div class="figure"><span>Prix moyen</span>&ngsp;<strong>{{ view.averagePrice === null ? 'pas encore' : money(view.averagePrice) + ' le poulet' }}</strong></div>
        <div class="figure"><span>Reste à vendre</span>&ngsp;<strong>{{ view.remaining === null ? 'pas encore connu' : view.remaining + ' poulets' }}</strong></div>
      </section>
    }
    <a class="new" routerLink="../vente" [queryParams]="{ lot: lotId() || null }"><app-pictogram picto="hen" [decorative]="true" /> Une vente</a>
    @if (sales.view()?.sales?.length === 0) {
      <p class="none"><app-pictogram picto="hen" [decorative]="true" /> Aucune vente pour ce lot.</p>
    }
    <ul class="sales">
      @for (sale of sales.view()?.sales ?? []; track sale.id) {
        <li class="sale" [class.owed]="due(sale) > 0">
          <a class="open" [routerLink]="sale.id" [queryParams]="{ lot: lotId() }">
            <app-pictogram class="face" [picto]="faceOf(sale)" [decorative]="true" />
            <span class="who"><b>{{ buyerOf(sale) }}</b>&ngsp;<small>{{ day(sale.soldOn) }} · {{ sale.birds }} poulet{{ sale.birds > 1 ? 's' : '' }} · {{ priceWords(sale) }}</small></span>&ngsp;<strong class="amount">{{ money(sale.amount) }}</strong>
            <span class="state">
              @if (due(sale) > 0) {
                <app-pictogram picto="stamp-pending" [decorative]="true" /> doit encore {{ money(due(sale)) }}
              } @else if (due(sale) < 0) {
                <app-pictogram picto="round-check" [decorative]="true" /> payé, tu lui dois {{ money(-due(sale)) }}
              } @else {
                <app-pictogram picto="round-check" [decorative]="true" /> payé
              }
            </span>
          </a>
        </li>
      }
    </ul>
  `,
  styles: `
    :host { display: block; }
    h1 { display: flex; align-items: center; gap: 8px; margin: 0 0 4px; font: 700 1.35rem var(--font-hand); color: var(--color-earth); }
    h1 app-pictogram { inline-size: 36px; block-size: 36px; }
    .back { display: inline-flex; align-items: center; min-block-size: 44px; margin-block-end: 6px; color: var(--color-ink); font-weight: 700; }
    .lots { display: flex; flex-wrap: wrap; gap: 8px; margin-block-end: 10px; }
    .lot { position: relative; padding: 8px 12px; border: 2px solid var(--color-card-edge); border-radius: 999px; font-weight: 700; color: var(--color-earth); cursor: pointer; }
    .lot input { position: absolute; inset: 0; opacity: 0; margin: 0; cursor: pointer; }
    .lot:has(input:checked) { border-color: var(--color-pasture); background: var(--color-pasture-light); }
    .figures { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-block-end: 12px; }
    .figure {
      display: grid; justify-items: start; gap: 2px; padding: 10px 12px; background: var(--color-shell);
      border: 2px solid var(--color-card-edge); border-radius: var(--radius-wobble-2); box-shadow: var(--shadow-hard-sm); color: var(--color-earth); font-weight: 700;
    }
    .figure strong { font: 700 1.15rem var(--font-hand); color: var(--color-ink); font-variant-numeric: tabular-nums; }
    .figure.margin { grid-column: 1 / -1; border-inline-start: 6px solid var(--color-pasture); }
    .figure.margin strong { font-size: 1.5rem; color: var(--color-pasture); }
    .figure.margin.minus { border-inline-start-color: var(--color-alert); }
    .figure.margin.minus strong { color: var(--color-alert); }
    .new {
      display: flex; align-items: center; justify-content: center; gap: 8px; min-block-size: 56px; margin-block-end: 14px;
      border: 3px solid var(--color-ink); border-radius: var(--radius-wobble-1); box-shadow: var(--shadow-hard);
      background: var(--color-pasture); color: var(--color-on-sign); font: 700 1.1rem var(--font-hand); text-decoration: none;
    }
    .new app-pictogram { inline-size: 28px; block-size: 28px; }
    .sales { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
    .sale { background: var(--color-shell); border: 2px solid var(--color-card-edge); border-inline-start: 6px solid var(--color-pasture); border-radius: var(--radius-wobble-2); box-shadow: var(--shadow-hard-sm); }
    .sale.owed { border-inline-start-color: var(--color-orange); }
    .open { display: grid; grid-template-columns: 44px 1fr auto; grid-template-areas: 'face who amount' 'state state state'; column-gap: 10px; row-gap: 6px; padding: 12px 14px; color: var(--color-ink); text-decoration: none; }
    .face { grid-area: face; inline-size: 44px; block-size: 44px; align-self: center; }
    .who { grid-area: who; display: grid; color: var(--color-earth); }
    .who b { font: 700 1.05rem var(--font-hand); }
    .who small { color: var(--color-muted); }
    .amount { grid-area: amount; align-self: center; font: 700 1.15rem var(--font-hand); white-space: nowrap; font-variant-numeric: tabular-nums; }
    .state { grid-area: state; display: flex; align-items: center; gap: 6px; font-weight: 700; color: var(--color-earth); }
    .state app-pictogram { inline-size: 22px; block-size: 22px; }
    .none { display: flex; align-items: center; gap: 10px; color: var(--color-muted); font-style: italic; }
    .none app-pictogram { inline-size: 26px; block-size: 26px; }
    a:focus-visible, .lot:has(input:focus-visible) { outline: var(--focus-ring); outline-offset: 2px; }
  `,
})
export class SalesPage {
  protected readonly sales = inject(Sales);
  private readonly purchases = inject(Purchases);
  private readonly office = inject(Office);
  private readonly officeSync = inject(OfficeSync);
  private readonly route = inject(ActivatedRoute);

  protected readonly lots = this.office.lots;
  protected readonly lotId = currentLotOf(this.office, this.route);
  protected readonly marginPhrase = computed((): PhrasePart[] => {
    const margin = this.sales.view()?.margin ?? null;
    if (margin === null) return [clip('sales-none-yet')];
    return [clip(margin < 0 ? 'sales-margin-negative' : 'sales-margin'), number(Math.abs(margin)), clip('money-francs')];
  });

  constructor() {
    void this.purchases.load();
    effect(() => {
      const lot = this.lotId();
      this.officeSync.revision();
      if (lot !== '') untracked(() => void this.sales.load(lot));
    });
  }

  protected money(amount: number): string {
    return amountWords(amount, this.sales.view()?.currency ?? this.purchases.currency() ?? '');
  }

  protected signed(amount: number): string {
    return `${amount < 0 ? '− ' : ''}${this.money(Math.abs(amount))}`;
  }

  protected due(sale: SaleView): number {
    return sale.amount - sale.received;
  }

  protected day(on: string): string {
    return dayWords(on);
  }

  protected priceWords(sale: SaleView): string {
    return sale.pricing.kind === 'PerBird' ? `${this.money(sale.pricing.unitPrice)} le poulet` : `${(sale.pricing.grams / 1000).toLocaleString('fr-FR')} kg à ${this.money(sale.pricing.pricePerKilo)}`;
  }

  protected buyerOf(sale: SaleView): string {
    return this.purchases.counterpartyById().get(sale.buyerId)?.name ?? 'Acheteur';
  }

  protected faceOf(sale: SaleView): PictogramName {
    return (this.purchases.counterpartyById().get(sale.buyerId)?.face ?? 'hen') as PictogramName;
  }
}
