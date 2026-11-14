import { ChangeDetectionStrategy, Component, computed, effect, inject, untracked } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { strainOf } from '@domain/journal';
import { Pictogram } from '../../ui/pictogram';
import { FiguresAge } from '../figures-age';
import { Office } from '../office';
import { amountWords } from '../purchases/purchases';
import { WeightChart } from './weight-chart/weight-chart';
import { Tracking } from './tracking';
import { CurrentLot, currentLotOf } from '../lots/current-lot';

// A no-break space between thousands: « 1 050 » never splits across two lines.
const thousands = (value: number): string => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
const signed = (value: number): string => (value > 0 ? `+${thousands(value)}` : value < 0 ? `−${thousands(-value)}` : '0');
const hundredth = (value: number): string => value.toFixed(2).replace('.', ',');

// The « Suivi » of a lot (V.3; CdC « L'onglet Suivi d'un lot », after bureau-admin.html): cost per
// bird, mortality and days; the weight against the strain; the feed against its table and the feed
// conversion; the sales from the first one. Every figure comes from the server; a figure without
// data stays blank — a dash, never zero.
@Component({
  selector: 'app-tracking-page',
  imports: [CurrentLot, FiguresAge, Pictogram, RouterLink, WeightChart],
  providers: [Tracking],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1><app-pictogram picto="paper" [decorative]="true" /> Suivi</h1>
    <a class="back" routerLink="..">Revenir aux lots</a>
    <app-current-lot />
    <app-figures-age [readAt]="tracking.readAt()" [stale]="tracking.unreachable()" />

    @if (tracking.view(); as view) {
      <div class="kpis">
        <p class="kpi cost"><strong>{{ view.costPerBird === null ? '—' : money(view.costPerBird) }}</strong>&ngsp;<span>coût par poulet</span></p>
        <p class="kpi mortality">
          <strong>{{ view.mortality === null ? '—' : percent(view.mortality) }}</strong>&ngsp;<span>mortalité</span>&ngsp;<small class="detail">{{ view.received === 0 ? 'aucun poussin reçu' : thousands(view.deaths) + ' mort' + (view.deaths > 1 ? 's' : '') + ' sur ' + thousands(view.received) }}</small>
        </p>
        <p class="kpi days"><strong>J{{ view.campaignDay }}<small>/{{ view.plannedDuration }}</small></strong>&ngsp;<span>jours</span></p>
      </div>

      <h2><app-pictogram picto="scale" [decorative]="true" /> Le poids</h2>
      <app-weight-chart [curve]="view.curve" [strain]="strain()" />

      <section class="feed" aria-label="L'aliment">
        <h2><app-pictogram picto="open-bag" [decorative]="true" /> L'aliment</h2>
        <p class="line cumulative">
          Cumul par poulet :
          @if (view.feed.cumulative === null) {
            — (aucun poussin reçu)
          } @else {
            <b>{{ thousands(view.feed.cumulative) }} g</b>
            @if (view.feed.target !== null && view.feed.variance !== null) {
              contre {{ thousands(view.feed.target) }} g dans la table {{ strainName() }} à J{{ view.campaignDay }}
              <span class="gap">{{ signed(view.feed.variance) }} g · {{ signed(Math.round((view.feed.variance / view.feed.target) * 100)) }} %</span>
            } @else {
              (la table ne donne pas ce jour)
            }
          }
        </p>
        <p class="line conversion">
          @if (view.feed.feedConversion; as conversion) {
            Indice de consommation à J{{ conversion.campaignDay }} : <b>{{ hundredth(conversion.value) }}</b>
            @if (conversion.target !== null) {
              contre {{ hundredth(conversion.target) }} au guide
              <span class="badge" [class.better]="conversion.value <= conversion.target" [class.worse]="conversion.value > conversion.target">
                {{ conversion.value <= conversion.target ? 'meilleur que la table' : 'plus que la table' }}
              </span>
            }
          } @else {
            Indice de consommation : — (aucune pesée validée)
          }
        </p>
        <p class="line bags">{{ view.feed.bagsOpened }} sac{{ view.feed.bagsOpened > 1 ? 's' : '' }} ouvert{{ view.feed.bagsOpened > 1 ? 's' : '' }} compté{{ view.feed.bagsOpened > 1 ? 's' : '' }}</p>
      </section>

      @if (view.sales; as sales) {
        <section class="sales" aria-label="Les ventes">
          <h2><app-pictogram picto="hen" [decorative]="true" /> Les ventes</h2>
          <p class="line margin">Marge <strong [class.negative]="sales.margin !== null && sales.margin < 0">{{ sales.margin === null ? '—' : money(sales.margin) }}</strong></p>
          <p class="line average">Prix moyen <strong>{{ sales.averagePrice === null ? '—' : money(sales.averagePrice) + ' le poulet' }}</strong></p>
          <p class="line remaining">Restant à vendre <strong>{{ sales.remaining === null ? '—' : thousands(sales.remaining) + ' poulet' + (sales.remaining > 1 ? 's' : '') }}</strong></p>
        </section>
      }
    } @else if (tracking.unreachable()) {
      <p class="unreachable" role="alert"><app-pictogram picto="sync-cloud" [decorative]="true" /> Pas de réseau : le suivi n’a pas encore été lu. Réessaie plus tard.</p>
    }
  `,
  styles: `
    :host { display: block; }
    h1 { display: flex; align-items: center; gap: 8px; margin: 0 0 4px; font: 700 1.35rem var(--font-hand); color: var(--color-earth); }
    h1 app-pictogram { inline-size: 36px; block-size: 36px; }
    h2 { display: flex; align-items: center; gap: 8px; margin: 18px 0 8px; font: 700 1.15rem var(--font-hand); color: var(--color-earth); }
    h2 app-pictogram { inline-size: 28px; block-size: 28px; }
    .back { display: inline-flex; align-items: center; min-block-size: 44px; margin-block-end: 6px; color: var(--color-ink); font-weight: 700; }
    .lots { display: flex; flex-wrap: wrap; gap: 8px; margin-block-end: 10px; }
    .lot { position: relative; padding: 8px 12px; border: 2px solid var(--color-card-edge); border-radius: 999px; font-weight: 700; color: var(--color-earth); cursor: pointer; }
    .lot input { position: absolute; inset: 0; opacity: 0; margin: 0; cursor: pointer; }
    .lot:has(input:checked) { border-color: var(--color-pasture); background: var(--color-pasture-light); }
    .kpis { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .kpi {
      display: flex; flex-direction: column; align-items: center; gap: 2px; margin: 0; padding: 10px 6px; text-align: center;
      background: var(--color-shell); border: 2px solid var(--color-card-edge); border-radius: var(--radius-wobble-2); box-shadow: var(--shadow-hard-sm);
    }
    .kpi strong { font: 700 1.3rem var(--font-hand); color: var(--color-ink); font-variant-numeric: tabular-nums; }
    .kpi strong small { font-size: 0.7em; color: var(--color-muted); }
    .kpi span { font-size: 0.78rem; font-weight: 700; color: var(--color-muted); }
    .kpi .detail { font-size: 0.72rem; color: var(--color-muted); }
    .feed, .sales { padding: 4px 12px 10px; background: var(--color-shell); border: 2px solid var(--color-card-edge); border-radius: var(--radius-wobble-2); box-shadow: var(--shadow-hard-sm); margin-block-start: 14px; }
    .feed h2, .sales h2 { margin-block-start: 10px; }
    .line { margin: 0; padding: 8px 0; border-block-end: 1px dashed var(--color-card-edge); color: var(--color-ink); line-height: 1.5; }
    .line:last-child { border-block-end: none; }
    .line b, .line strong { font-variant-numeric: tabular-nums; }
    .gap { display: inline-block; margin-inline-start: 4px; padding: 0 6px; border-radius: 4px; background: var(--color-desk); font-weight: 700; color: var(--color-earth); white-space: nowrap; }
    .badge { display: inline-block; margin-inline-start: 4px; padding: 0 6px; border-radius: 4px; font-weight: 700; white-space: nowrap; }
    .badge.better { background: var(--color-pasture-light); color: var(--color-pasture); }
    .badge.worse { background: var(--color-orange-light); color: var(--color-earth); }
    .bags { color: var(--color-muted); font-size: 0.9rem; }
    .sales .line { display: flex; justify-content: space-between; gap: 10px; }
    .sales strong { font: 700 1.1rem var(--font-hand); }
    .negative { color: var(--color-alert); }
    .unreachable { display: flex; align-items: center; gap: 8px; padding: 10px; border-inline-start: 4px solid var(--color-orange); background: var(--color-orange-light); color: var(--color-earth); font-weight: 700; }
    .unreachable app-pictogram { inline-size: 24px; block-size: 24px; flex: none; }
    a:focus-visible, .lot:has(input:focus-visible) { outline: var(--focus-ring); outline-offset: 2px; }
  `,
})
export class TrackingPage {
  protected readonly tracking = inject(Tracking);
  private readonly office = inject(Office);
  private readonly route = inject(ActivatedRoute);

  protected readonly lots = this.office.lots;
  protected readonly lotId = currentLotOf(this.office, this.route);
  protected readonly strain = computed(() => strainOf(this.tracking.view()?.strain ?? ''));
  protected readonly strainName = computed(() => this.strain()?.name ?? this.tracking.view()?.strain ?? '');
  protected readonly Math = Math;
  protected readonly thousands = thousands;
  protected readonly signed = signed;
  protected readonly hundredth = hundredth;

  constructor() {
    effect(() => {
      const lot = this.lotId();
      if (lot !== '') untracked(() => void this.tracking.load(lot));
    });
  }

  protected money(amount: number): string {
    return amountWords(amount, this.tracking.view()?.currency ?? '');
  }

  /** 0.062 → « 6,2 % ». */
  protected percent(ratio: number): string {
    return `${(ratio * 100).toFixed(1).replace('.', ',')} %`;
  }
}
