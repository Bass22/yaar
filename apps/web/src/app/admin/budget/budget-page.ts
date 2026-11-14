import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { SaleForecasts } from './sale-forecasts';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { BudgetLineView, BudgetView, CostCategoryCode } from '@contracts';
import { AuthService } from '../../core/session/auth';
import { Pictogram } from '../../ui/pictogram';
import { CATEGORY_PICTO } from '../money/expenses';
import { Office } from '../office';
import { amountWords } from '../purchases/purchases';
import { currencyWord, grouped, typedNumber } from '../typed-number';
import { CurrentLot, currentLotOf } from '../lots/current-lot';
import { authHeaders } from '../../core/session/auth-headers';

/** The categories of the base, as the office says them (CLAUDE.md glossary). */
const CATEGORY_WORDS: Record<CostCategoryCode, string> = {
  Feed: 'Aliments',
  Chicks: 'Poussins',
  Health: 'Santé',
  Bedding: 'Litière',
  Labour: 'Main-d’œuvre',
  Equipment: 'Équipement',
  Cleaning: 'Nettoyage',
  Transport: 'Transport',
  Processing: 'Transformation',
  Utilities: 'Énergie et eau',
  FinancialCharges: 'Frais financiers',
  Other: 'Autres',
};

/** What the box holds: `null` when empty (no budget), `undefined` when it is not whole francs. */
const amountOf = (typed: string): number | null | undefined => {
  const value = typed.replace(/\s/g, '');
  if (value === '') return null;
  return /^\d+$/.test(value) ? Number(value) : undefined;
};

// The budget of a lot against its committed cost (S.1, S.3; CdC « Budget de campagne »): a line a
// category, the proposal of the closed lots filling an empty box, the committed cost and what is
// left — or the overrun, said by picto, colour and word. Online only.
@Component({
  selector: 'app-budget-page',
  imports: [CurrentLot, Pictogram, RouterLink, SaleForecasts],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1><app-pictogram picto="coin" [decorative]="true" /> Budget</h1>
    <a class="back" routerLink="..">Revenir aux lots</a>
    <app-current-lot />

    @if (view(); as budget) {
      @if (lot(); as current) {
      }
      <p class="hint">Un plan par poste, jamais une dette : il ne change ni l’engagé ni les tiers. {{ thousands(budget.plannedHeadcount) }} poussins prévus.</p>
      @for (line of budget.lines; track line.category) {
        <div class="post" [attr.data-category]="line.category">
          <span class="name"><app-pictogram [picto]="picto(line.category)" [decorative]="true" /> {{ words[line.category] }}</span>
          <label class="field">
            <input class="amount" type="text" inputmode="numeric" [value]="grouped(typed(line))" (input)="type(line.category, $event)" [disabled]="budget.closed" [attr.aria-label]="'Budget ' + words[line.category] + ', en francs'" />
            <span>{{ currencyWord(budget.currency) }}</span>
          </label>
          @if (line.budget === null && line.suggested !== null) {
            <small class="suggested">proposé d’après tes bandes closes</small>
          }
          <span class="committed">engagé {{ money(line.committed) }}</span>
          @if (line.variance === null) {
            <span class="variance none">pas de budget</span>
          } @else if (line.variance < 0) {
            <span class="variance overrun"><app-pictogram picto="bell" [decorative]="true" /> dépassé de {{ money(-line.variance) }}</span>
          } @else {
            <span class="variance">reste {{ money(line.variance) }}</span>
          }
        </div>
      }
      @if (invalid()) {
        <p class="invalid" role="alert">Un budget s’écrit en francs entiers.</p>
      }
      @if (!budget.closed) {
        <button type="button" class="save" [disabled]="invalid() || sending()" (click)="save(budget)">Enregistrer le budget</button>
      }
      @if (refusal(); as said) {
        <p class="refusal" role="alert">{{ said }}</p>
      }
      <!-- What the flock should bring, against this budget (W.4) -->
      <app-sale-forecasts [campaignId]="budget.campaignId" />
    } @else if (unreachable()) {
      <p class="unreachable" role="alert">Pas de réseau : le budget se lit en ligne. Réessaie plus tard.</p>
    }
  `,
  styles: `
    :host { display: block; }
    h1 { display: flex; align-items: center; gap: 8px; margin: 0 0 4px; font: 700 1.35rem var(--font-hand); color: var(--color-earth); }
    h1 app-pictogram { inline-size: 36px; block-size: 36px; }
    .back { display: inline-flex; align-items: center; min-block-size: 44px; margin-block-end: 6px; color: var(--color-ink); font-weight: 700; }
    .lots { display: flex; flex-wrap: wrap; gap: 8px; margin-block-end: 10px; }
    .lot { position: relative; display: inline-flex; align-items: center; min-block-size: 44px; padding: 0 12px; border: 2px solid var(--color-card-edge); border-radius: 999px; font-weight: 700; color: var(--color-earth); cursor: pointer; }
    .lot input { position: absolute; inset: 0; opacity: 0; margin: 0; cursor: pointer; }
    .lot:has(input:checked) { border-color: var(--color-pasture); background: var(--color-pasture-light); }
    .current { margin: 0 0 4px; font: 700 1.1rem var(--font-hand); color: var(--color-ink); }
    .hint { margin: 0 0 8px; color: var(--color-muted); font-size: 0.9rem; }
    .post {
      display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 10px; align-items: center; padding: 10px 12px; margin-block-start: 8px;
      background: var(--color-shell); border: 2px solid var(--color-card-edge); border-radius: var(--radius-wobble-2); box-shadow: var(--shadow-hard-sm);
    }
    .name { display: flex; align-items: center; gap: 8px; font-weight: 700; color: var(--color-ink); }
    .name app-pictogram { inline-size: 26px; block-size: 26px; }
    .field { display: inline-flex; align-items: center; gap: 4px; color: var(--color-muted); }
    .amount { inline-size: 6.5em; min-block-size: 44px; padding: 0 8px; border: 2px solid var(--color-card-edge); border-radius: 4px; background: var(--color-paper); color: var(--color-ink); font: 700 1.05rem var(--font-hand); text-align: end; font-variant-numeric: tabular-nums; }
    .suggested { grid-column: 1 / -1; justify-self: end; color: var(--color-muted); font-style: italic; }
    .committed { color: var(--color-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .variance { justify-self: end; font-weight: 700; color: var(--color-pasture); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .variance.none { color: var(--color-muted); font-weight: 400; }
    .variance.overrun { display: inline-flex; align-items: center; gap: 4px; color: var(--color-alert); }
    .variance.overrun app-pictogram { inline-size: 20px; block-size: 20px; }
    .invalid, .refusal, .unreachable { margin: 10px 0 0; padding: 8px 10px; border-inline-start: 4px solid var(--color-alert); background: var(--color-orange-light); color: var(--color-ink); font-weight: 700; }
    .save { inline-size: 100%; min-block-size: 56px; margin-block-start: 16px; border: 3px solid var(--color-ink); border-radius: var(--radius-wobble-1); box-shadow: var(--shadow-hard); background: var(--color-pasture); color: var(--color-on-sign); font: 700 1.1rem var(--font-hand); cursor: pointer; }
    .save:disabled { opacity: 0.5; cursor: not-allowed; }
    a:focus-visible, button:focus-visible, .amount:focus-visible, .lot:has(input:focus-visible) { outline: var(--focus-ring); outline-offset: 2px; }
  `,
})
export class BudgetPage {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly office = inject(Office);
  private readonly route = inject(ActivatedRoute);

  protected readonly words = CATEGORY_WORDS;
  protected readonly currencyWord = currencyWord;
  protected readonly lots = this.office.lots;
  protected readonly lotId = currentLotOf(this.office, this.route);
  protected readonly lot = computed(() => this.lots().find((lot) => lot.campaignId === this.lotId()) ?? null);
  protected readonly view = signal<BudgetView | null>(null);
  protected readonly unreachable = signal(false);
  private readonly edits = signal<ReadonlyMap<string, string>>(new Map());
  protected readonly sending = signal(false);
  protected readonly refusal = signal<string | null>(null);
  protected readonly invalid = computed(() => (this.view()?.lines ?? []).some((line) => amountOf(this.typed(line)) === undefined));

  constructor() {
    effect(() => {
      const lot = this.lotId();
      if (lot !== '') untracked(() => void this.load(lot));
    });
  }

  protected readonly grouped = grouped;

  /** What the box shows: what was typed, or the budget written, or the proposal. */
  protected typed(line: BudgetLineView): string {
    return this.edits().get(line.category) ?? String(line.budget ?? line.suggested ?? '');
  }

  protected type(category: string, event: Event): void {
    // Kept without the spaces of thousands, shown with them (Q.10).
    this.edits.update((edits) => new Map(edits).set(category, typedNumber(event)));
  }

  /** « 1 050 », never split across two lines. */
  protected thousands(value: number): string {
    return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
  }

  protected picto(category: CostCategoryCode) {
    return CATEGORY_PICTO[category] ?? 'paper';
  }

  protected money(amount: number): string {
    return amountWords(amount, this.view()?.currency ?? '').replace(/ /g, ' ');
  }

  protected async save(budget: BudgetView): Promise<void> {
    // Only what changes: a proposal kept is written, a box emptied takes the budget off.
    const lines = budget.lines.flatMap((line) => {
      const amount = amountOf(this.typed(line));
      return amount === undefined || amount === line.budget ? [] : [{ category: line.category, amount }];
    });
    if (lines.length === 0) return;
    this.sending.set(true);
    try {
      await firstValueFrom(this.http.put(`/api/v1/campaigns/${budget.campaignId}/budget`, { id: crypto.randomUUID(), lines }, { headers: this.headers() }));
      this.refusal.set(null);
      this.edits.set(new Map());
      await this.load(budget.campaignId);
    } catch (error) {
      this.refusal.set(error instanceof HttpErrorResponse && error.status >= 400 && error.status < 500 ? 'Le budget est refusé.' : 'Pas de réseau : le budget s’enregistre en ligne. Réessaie plus tard.');
    } finally {
      this.sending.set(false);
    }
  }

  private async load(campaignId: string): Promise<void> {
    try {
      this.view.set(await firstValueFrom(this.http.get<BudgetView>(`/api/v1/campaigns/${campaignId}/budget`, { headers: this.headers() })));
      this.unreachable.set(false);
    } catch {
      this.view.set(null);
      this.unreachable.set(true);
    }
  }

  private headers(): HttpHeaders {
    const session = this.auth.session();
    return authHeaders(session);
  }
}
