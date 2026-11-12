import { ChangeDetectionStrategy, Component, computed, effect, inject, linkedSignal, signal, untracked } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { PictogramName } from '@design-system';
import type { CostView } from '@contracts';
import { clip, number, type PhrasePart } from '../../core/audio/phrase';
import { Pictogram } from '../../ui/pictogram';
import { SpeakerButton } from '../../ui/speaker-button';
import { FiguresAge } from '../figures-age';
import { OfficePending } from '../office-pending';
import { OfficeSync } from '../office-sync';
import { Office } from '../office';
import { amountWords, Purchases } from '../purchases/purchases';
import { Banknotes } from './banknotes';
import { CATEGORY_PICTO, Expenses } from './expenses';

// The expenses of a lot (P.4, P.5; CdC « Les dépenses »): the committed cost and the cost per bird,
// computed by the server, each with its listen button; then every expense, dated, with its type,
// amount, status, « reçu ✓ » and its note whole. An expense owed is paid in one tap; any expense
// is duplicated (the gesture filled at today's date, nothing written) or corrected (a counter-entry).
@Component({
  selector: 'app-expenses-page',
  imports: [Banknotes, FiguresAge, OfficePending, Pictogram, RouterLink, SpeakerButton],
  providers: [Expenses],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1><app-pictogram picto="coin" [decorative]="true" /> Dépenses</h1>
    <a class="back" routerLink="..">Revenir aux commandes</a>
    @if (lots().length > 1) {
      <div class="lots" role="radiogroup" aria-label="Quel lot ?">
        @for (lot of lots(); track lot.campaignId) {
          <label class="lot">
            <input type="radio" name="lot" [checked]="lot.campaignId === lotId()" (change)="lotId.set(lot.campaignId)" />
            {{ lot.siteName }} · Jour {{ lot.campaignDay }}
          </label>
        }
      </div>
    }
    <app-figures-age [readAt]="expenses.readAt()" [stale]="expenses.unreachable()" />
    <app-office-pending [kinds]="['cost']" [subject]="lotId()" />
    @if (expenses.money(); as money) {
      <section class="totals" aria-label="L'argent du lot">
        <div class="total">
          <span>Engagé à date</span>&ngsp;<strong>{{ words(money.committed) }}</strong>
          <app-speaker-button [phrase]="committedPhrase()" label="Écouter l'engagé" />
        </div>
        <div class="total">
          <span>Coût par poulet</span>&ngsp;<strong>{{ money.costPerBird === null ? 'pas encore connu' : words(money.costPerBird) }}</strong>
          <app-speaker-button [phrase]="perBirdPhrase()" label="Écouter le coût par poulet" />
        </div>
      </section>
    }
    <a class="new" routerLink="../depense" [queryParams]="{ lot: lotId() || null }"><app-pictogram picto="pencil" [decorative]="true" /> Une dépense</a>
    @if (problem(); as problem) {
      <p class="refusal" role="alert"><app-pictogram picto="cross" [decorative]="true" /> {{ problem }}</p>
    }
    @if (expenses.money()?.costs?.length === 0) {
      <p class="none"><app-pictogram picto="coin" [decorative]="true" /> Aucune dépense pour ce lot.</p>
    }
    <ul class="costs">
      @for (cost of costs(); track cost.id) {
        <li class="cost" [class.owed]="cost.payment.kind === 'ToPay'">
          <app-pictogram class="what" [picto]="pictoOf(cost)" [decorative]="true" />
          <span class="head">
            <b>{{ typeName(cost) }}</b>
            <small>{{ dayWords(cost.spentOn) }}{{ cost.history.length > 1 ? ' · corrigée' : '' }}</small>
          </span>
          <strong class="sum">{{ words(cost.amount) }}</strong>
          <app-banknotes class="notes" [amount]="cost.amount" />
          <span class="status">
            @if (cost.payment.kind === 'Paid') {
              <app-pictogram picto="round-check" [decorative]="true" /> Payé
            } @else {
              <app-pictogram picto="stamp-pending" [decorative]="true" /> À payer à {{ creditorName(cost) }}
            }
            @if (cost.receipt !== null) {
              <span class="receipt">· reçu ✓</span>
            }
          </span>
          @if (cost.note !== null) {
            <p class="cost-note">{{ cost.note }}</p>
          }
          <span class="acts">
            @if (cost.payment.kind === 'ToPay') {
              <button type="button" class="pay" [disabled]="paying() === cost.id" (click)="markPaid(cost)"><app-pictogram picto="check" [decorative]="true" /> C'est payé</button>
            }
            <a class="act duplicate" routerLink="../depense" [queryParams]="{ lot: lotId(), from: cost.id }">Dupliquer</a>
            <a class="act correct" routerLink="../depense" [queryParams]="{ lot: lotId(), corrige: cost.id }"><app-pictogram picto="pencil" [decorative]="true" /> Corriger</a>
          </span>
        </li>
      }
    </ul>
  `,
  styles: `
    :host { display: block; }
    h1 { display: flex; align-items: center; gap: 8px; margin: 0 0 4px; font: 700 1.35rem var(--font-hand); color: var(--color-earth); }
    h1 app-pictogram { inline-size: 34px; block-size: 34px; }
    .back { display: inline-flex; align-items: center; min-block-size: 44px; margin-block-end: 6px; color: var(--color-ink); font-weight: 700; }
    .lots { display: flex; flex-wrap: wrap; gap: 8px; margin-block-end: 10px; }
    .lot { position: relative; padding: 8px 12px; border: 2px solid var(--color-card-edge); border-radius: 999px; font-weight: 700; color: var(--color-earth); cursor: pointer; }
    .lot input { position: absolute; inset: 0; opacity: 0; margin: 0; cursor: pointer; }
    .lot:has(input:checked) { border-color: var(--color-pasture); background: var(--color-pasture-light); }
    .totals { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-block-end: 12px; }
    .total {
      display: grid; justify-items: start; gap: 2px; padding: 10px 12px; background: var(--color-shell);
      border: 2px solid var(--color-card-edge); border-radius: var(--radius-wobble-2); box-shadow: var(--shadow-hard-sm); color: var(--color-earth); font-weight: 700;
    }
    .total strong { font: 700 1.3rem var(--font-hand); color: var(--color-ink); font-variant-numeric: tabular-nums; }
    .new {
      display: flex; align-items: center; justify-content: center; gap: 8px; min-block-size: 56px; margin-block-end: 14px;
      border: 3px solid var(--color-ink); border-radius: var(--radius-wobble-1); box-shadow: var(--shadow-hard);
      background: var(--color-pasture); color: var(--color-on-sign); font: 700 1.1rem var(--font-hand); text-decoration: none;
    }
    .new app-pictogram { inline-size: 26px; block-size: 26px; }
    .costs { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
    .cost {
      display: grid; grid-template-columns: 44px 1fr auto; grid-template-areas: 'what head sum' 'notes notes notes' 'status status status' 'memo memo memo' 'acts acts acts';
      column-gap: 10px; row-gap: 6px; padding: 12px 14px; background: var(--color-shell);
      border: 2px solid var(--color-card-edge); border-inline-start: 6px solid var(--color-pasture); border-radius: var(--radius-wobble-2); box-shadow: var(--shadow-hard-sm);
    }
    .cost.owed { border-inline-start-color: var(--color-orange); }
    .what { grid-area: what; inline-size: 44px; block-size: 44px; align-self: center; }
    .head { grid-area: head; display: grid; color: var(--color-earth); }
    .head b { font: 700 1.05rem var(--font-hand); }
    .head small { color: var(--color-muted); }
    .sum { grid-area: sum; align-self: center; font: 700 1.15rem var(--font-hand); color: var(--color-ink); white-space: nowrap; font-variant-numeric: tabular-nums; }
    .notes { grid-area: notes; }
    .status { grid-area: status; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-weight: 700; color: var(--color-earth); }
    .status app-pictogram { inline-size: 22px; block-size: 22px; }
    .receipt { color: var(--color-pasture); }
    .cost-note { grid-area: memo; margin: 0; padding: 6px 8px; background-image: var(--notebook-lines); line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--color-ink); }
    .acts { grid-area: acts; display: flex; flex-wrap: wrap; gap: 8px; }
    .pay, .act {
      display: inline-flex; align-items: center; gap: 6px; min-block-size: 44px; padding: 0 12px; cursor: pointer; text-decoration: none;
      border: 2px solid var(--color-ink); border-radius: var(--radius-wobble-1); background: var(--color-paper); color: var(--color-ink); font: 700 0.95rem var(--font-hand);
    }
    .pay { background: var(--color-pasture); color: var(--color-on-sign); }
    .pay app-pictogram, .act app-pictogram { inline-size: 20px; block-size: 20px; }
    .pay:disabled { opacity: 0.6; }
    .none, .refusal { display: flex; align-items: center; gap: 10px; margin: 0 0 12px; }
    .none { color: var(--color-muted); font-style: italic; }
    .none app-pictogram, .refusal app-pictogram { inline-size: 26px; block-size: 26px; flex: none; }
    .refusal { padding: 10px 12px; border-inline-start: 5px solid var(--color-alert); background: var(--color-alert-light); color: var(--color-alert); font-weight: 700; }
    a:focus-visible, button:focus-visible, .lot:has(input:focus-visible) { outline: var(--focus-ring); outline-offset: 2px; }
  `,
})
export class ExpensesPage {
  protected readonly expenses = inject(Expenses);
  private readonly purchases = inject(Purchases);
  private readonly office = inject(Office);
  private readonly route = inject(ActivatedRoute);

  protected readonly lots = this.office.lots;
  protected readonly lotId = linkedSignal(() => this.route.snapshot.queryParamMap.get('lot') ?? this.office.lots()[0]?.campaignId ?? '');
  protected readonly paying = signal<string | null>(null);
  protected readonly problem = signal<string | null>(null);
  /** The latest spent on top. */
  protected readonly costs = computed(() => [...(this.expenses.money()?.costs ?? [])].reverse());

  protected readonly committedPhrase = computed((): PhrasePart[] => [clip('committed'), number(this.expenses.money()?.committed ?? 0), clip('money-francs')]);
  protected readonly perBirdPhrase = computed((): PhrasePart[] => {
    const perBird = this.expenses.money()?.costPerBird ?? null;
    return perBird === null ? [clip('cost-per-bird-unknown')] : [clip('cost-per-bird'), number(perBird), clip('money-francs')];
  });

  private readonly officeSync = inject(OfficeSync);

  constructor() {
    void this.purchases.load();
    // The lot chosen, and again whenever the server has received what was waiting (P.7).
    effect(() => {
      const lot = this.lotId();
      this.officeSync.revision();
      if (lot !== '') untracked(() => void this.expenses.load(lot));
    });
  }

  protected words(amount: number): string {
    return amountWords(amount, this.expenses.money()?.currency ?? this.purchases.currency() ?? '');
  }

  protected dayWords(day: string): string {
    const [year, month, date] = day.split('-');
    return `${date}/${month}/${year}`;
  }

  protected pictoOf(cost: CostView): PictogramName {
    return CATEGORY_PICTO[this.purchases.costTypeById().get(cost.costTypeId)?.category ?? 'Other'] ?? 'paper';
  }

  protected typeName(cost: CostView): string {
    return this.purchases.costTypeById().get(cost.costTypeId)?.name ?? 'Dépense';
  }

  protected creditorName(cost: CostView): string {
    return cost.payment.kind === 'ToPay' ? (this.purchases.counterpartyById().get(cost.payment.counterpartyId)?.name ?? '…') : '';
  }

  /** « À payer » → payé in one tap: a counter-entry that changes only the status (P.2). */
  protected async markPaid(cost: CostView): Promise<void> {
    this.paying.set(cost.id);
    const problem = await this.expenses.save(
      { id: crypto.randomUUID(), campaignId: this.lotId(), costTypeId: cost.costTypeId, spentOn: cost.spentOn, amount: cost.amount, note: cost.note, payment: { kind: 'Paid' }, receipt: cost.receipt },
      cost.id,
    );
    this.paying.set(null);
    this.problem.set(problem === null ? null : 'L’appareil n’arrive pas à garder ce changement. Réessaie.');
  }
}
