import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { ClosingReportView, LeftoverView } from '@contracts';
import { Pictogram } from '../../ui/pictogram';
import { amountWords } from '../purchases/purchases';
import { Closing } from './closing';
import { dayWords } from '../typed-number';

// A no-break space between thousands: « 1 000 » never splits across two lines.
const thousands = (value: number): string => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

// The report of a closed lot (X.1, X.2; CdC « Les restes et le bilan »), shown only once it is
// closed: the cost per chick received against the sale price per chick received, the profit;
// the birds, the money, the leftovers and where they went; the comment, whole.
@Component({
  selector: 'app-closing-report-page',
  imports: [Pictogram, RouterLink],
  providers: [Closing],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1><app-pictogram picto="paper" [decorative]="true" /> Bilan</h1>
    <a class="back" routerLink="/admin/lots/clos">Revenir aux lots clôturés</a>
    @if (report(); as view) {
      <p class="lot">{{ view.siteName }} · mise en place le {{ day(view.placementDay) }}, close le {{ day(view.closedAt.slice(0, 10)) }}</p>
      <div class="kpis">
        <p class="kpi cost"><strong>{{ view.costPerBird === null ? '—' : money(view.costPerBird, view.currency) }}</strong>&ngsp;<span>coût par poussin reçu</span></p>
        <p class="kpi price"><strong>{{ view.revenuePerChick === null ? '—' : money(view.revenuePerChick, view.currency) }}</strong>&ngsp;<span>vente par poussin reçu</span></p>
        <p class="kpi profit"><strong [class.negative]="view.profit < 0">{{ signedMoney(view.profit, view.currency) }}</strong>&ngsp;<span>bénéfice</span></p>
      </div>

      <section class="sheet flock" aria-label="Les poulets">
        <h2><app-pictogram picto="chick" [decorative]="true" /> Les poulets</h2>
        <p class="line">Poussins reçus <b>{{ thousands(view.chicksReceived) }}</b></p>
        <p class="line">Morts <b>{{ thousands(view.deaths) }}</b></p>
        <p class="line">Pertes (manquants, dons, vols) <b>{{ thousands(view.losses) }}</b></p>
        <p class="line">Poulets vendus <b>{{ thousands(view.birdsSold) }}</b></p>
      </section>

      <section class="sheet money" aria-label="L'argent">
        <h2><app-pictogram picto="coin" [decorative]="true" /> L'argent</h2>
        <p class="line">Coûts <b>{{ money(view.costs, view.currency) }}</b></p>
        <p class="line">Restes transférés <b>− {{ money(view.leftoversValue, view.currency) }}</b></p>
        <p class="line net">Coût net <b>{{ money(view.netCost, view.currency) }}</b></p>
        <p class="line">Chiffre d’affaires <b>{{ money(view.revenue, view.currency) }}</b></p>
        <p class="line">Encaissé <b>{{ money(view.cashedIn, view.currency) }}</b></p>
      </section>

      <section class="sheet leftovers" aria-label="Les restes">
        <h2><app-pictogram picto="open-bag" [decorative]="true" /> Restes</h2>
        @if (view.leftovers.length === 0) {
          <p class="none">Aucun reste.</p>
        } @else {
          <ul>
            @for (leftover of view.leftovers; track leftover.costTypeId) {
              <li>
                <span>{{ leftover.name }} : {{ quantity(leftover) }}</span>&ngsp;<b [class.unknown]="leftover.value === null">{{ leftover.value === null ? 'valeur inconnue' : money(leftover.value, view.currency) }}</b>
              </li>
            }
          </ul>
          @if (view.leftoversTo; as to) {
            <p class="to">Passés à la bande du {{ to.siteName }} mise en place le {{ day(to.placementDay) }}.</p>
          }
        }
      </section>

      @if (view.feedGap !== 0) {
        <p class="feed-gap" role="note">Sacs d’aliment : {{ gapWords(view.feedGap) }}.&ngsp;<span class="feed-gap-comment">{{ view.feedGapComment }}</span></p>
      }

      @if (view.comment !== null) {
        <section class="sheet" aria-label="Commentaire">
          <h2><app-pictogram picto="pencil" [decorative]="true" /> Commentaire</h2>
          <p class="comment">{{ view.comment }}</p>
        </section>
      }
    } @else if (missing()) {
      <p class="missing" role="alert">Pas de bilan : cette bande n’est pas close, ou le réseau manque.</p>
    }
  `,
  styles: `
    :host { display: block; }
    h1 { display: flex; align-items: center; gap: 8px; margin: 0 0 4px; font: 700 1.35rem var(--font-hand); color: var(--color-earth); }
    h1 app-pictogram { inline-size: 36px; block-size: 36px; }
    h2 { display: flex; align-items: center; gap: 8px; margin: 10px 0 6px; font: 700 1.15rem var(--font-hand); color: var(--color-earth); }
    h2 app-pictogram { inline-size: 28px; block-size: 28px; }
    .back { display: inline-flex; align-items: center; min-block-size: 44px; margin-block-end: 6px; color: var(--color-ink); font-weight: 700; }
    .lot { margin: 0 0 10px; color: var(--color-muted); font-weight: 700; }
    .kpis { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .kpi { display: flex; flex-direction: column; align-items: center; gap: 2px; margin: 0; padding: 10px 6px; text-align: center; background: var(--color-shell); border: 2px solid var(--color-card-edge); border-radius: var(--radius-wobble-2); box-shadow: var(--shadow-hard-sm); }
    .kpi strong { font: 700 1.2rem var(--font-hand); color: var(--color-ink); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .kpi span { font-size: 0.78rem; font-weight: 700; color: var(--color-muted); }
    .negative { color: var(--color-alert) !important; }
    .sheet { padding: 4px 12px 10px; margin-block-start: 14px; background: var(--color-shell); border: 2px solid var(--color-card-edge); border-radius: var(--radius-wobble-2); box-shadow: var(--shadow-hard-sm); }
    .line { display: flex; justify-content: space-between; gap: 10px; margin: 0; padding: 8px 0; border-block-end: 1px dashed var(--color-card-edge); color: var(--color-ink); }
    .line:last-child { border-block-end: none; }
    .line b, li b { font-variant-numeric: tabular-nums; white-space: nowrap; }
    .net { font-weight: 700; }
    ul { margin: 0; padding: 0; list-style: none; }
    li { display: flex; justify-content: space-between; gap: 10px; padding: 8px 0; border-block-end: 1px dashed var(--color-card-edge); color: var(--color-ink); }
    .unknown { color: var(--color-muted); font-weight: 400; font-style: italic; }
    .to, .none { margin: 8px 0 0; color: var(--color-muted); }
    .feed-gap { margin: 10px 0 0; padding: 8px 10px; border-inline-start: 4px solid var(--color-orange); background: var(--color-orange-light); color: var(--color-ink); font-weight: 700; }
    .feed-gap-comment { font-weight: 400; white-space: pre-wrap; }
    .comment { margin: 0; white-space: pre-wrap; line-height: 1.6; color: var(--color-ink); background-image: repeating-linear-gradient(transparent 0 calc(1.6em - 1px), var(--color-card-edge) calc(1.6em - 1px) 1.6em); }
    .missing { padding: 10px; border-inline-start: 4px solid var(--color-orange); background: var(--color-orange-light); color: var(--color-earth); font-weight: 700; }
    a:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }
  `,
})
export class ClosingReportPage {
  private readonly closing = inject(Closing);
  private readonly route = inject(ActivatedRoute);

  protected readonly report = signal<ClosingReportView | null>(null);
  protected readonly missing = signal(false);
  protected readonly thousands = thousands;
  protected readonly day = dayWords;

  constructor() {
    void this.load(this.route.snapshot.paramMap.get('id') ?? '');
  }

  protected money(amount: number, currency: string): string {
    return amountWords(amount, currency).replace(/ /g, ' ');
  }

  /** Signed with a true minus: « −120 000 F ». */
  protected signedMoney(amount: number, currency: string): string {
    return amount < 0 ? `−${this.money(-amount, currency)}` : this.money(amount, currency);
  }

  /** « 2 sacs et un entamé », « 1 sac », « un entamé ». */
  protected quantity({ unit, whole, opened, openedWeight }: LeftoverView): string {
    const word = unit === 'bag' ? (whole > 1 ? 'sacs' : 'sac') : whole > 1 ? 'unités' : 'unité';
    const full = whole > 0 ? `${thousands(whole)} ${word}` : '';
    // The grams left in the opened bag of feed, when known (N.8d)
    const entame = openedWeight === null ? 'un entamé' : `un entamé (${thousands(Math.round(openedWeight / 1000))} kg)`;
    return opened ? (full === '' ? entame : `${full} et ${entame}`) : full;
  }

  /** « 1 de moins qu’attendu », « 2 de plus qu’attendu » (N.8d). */
  protected gapWords(gap: number): string {
    return gap < 0 ? `${thousands(-gap)} de moins qu’attendu` : `${thousands(gap)} de plus qu’attendu`;
  }

  private async load(campaignId: string): Promise<void> {
    const report = await this.closing.report(campaignId);
    this.report.set(report);
    this.missing.set(report === null);
  }
}
