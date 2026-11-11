import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { PictogramName } from '@design-system';
import type { CounterpartyLedgerView } from '@contracts';
import { clip, number, type PhrasePart } from '../../../core/audio/phrase';
import { Pictogram } from '../../../ui/pictogram';
import { SpeakerButton } from '../../../ui/speaker-button';
import { amountWords, Purchases } from '../../purchases/purchases';
import { Banknotes } from '../banknotes';
import { balancePhrase, Ledger } from './ledger';

// « Qui doit quoi » (R.3; bureau-admin-v2.html screens 5 and 10): what you owe and what is owed
// to you, summed by the server; then one line per counterparty — its face, its name, the direction
// seen without reading (a red arrow from you to it, a green one back to you, and the words), the
// amount in notes. A settled counterparty carries no arrow. Touching a line opens its ledger.
@Component({
  selector: 'app-ledger-page',
  imports: [Banknotes, Pictogram, RouterLink, SpeakerButton],
  providers: [Ledger],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1><app-pictogram picto="coin" [decorative]="true" /> Qui doit quoi</h1>
    @if (ledger.unreachable()) {
      <p class="refusal" role="alert"><app-pictogram picto="sync-cloud" [decorative]="true" /> Pas de réseau : les soldes ne se lisent pas.</p>
    }
    @if (ledger.view(); as view) {
      <section class="totals" aria-label="En tout">
        <div class="total you-owe">
          <span class="arrow" aria-hidden="true">→</span>
          <span>Tu dois</span>&ngsp;<strong>{{ money(view.youOwe) }}</strong>
          <app-speaker-button [phrase]="totalPhrase('ledger-total-you-owe', view.youOwe)" label="Écouter ce que tu dois" />
        </div>
        <div class="total owed">
          <span class="arrow" aria-hidden="true">←</span>
          <span>On te doit</span>&ngsp;<strong>{{ money(view.owedToYou) }}</strong>
          <app-speaker-button [phrase]="totalPhrase('ledger-total-owed-to-you', view.owedToYou)" label="Écouter ce qu’on te doit" />
        </div>
      </section>
      @if (view.counterparties.length === 0) {
        <p class="none"><app-pictogram picto="coin" [decorative]="true" /> Personne ne doit rien pour l’instant.</p>
      }
      <ul class="lines">
        @for (line of view.counterparties; track line.counterpartyId) {
          <li class="line" [class.you-owe]="line.balance < 0" [class.owed]="line.balance > 0" [class.settled]="line.balance === 0">
            <a class="open" [routerLink]="line.counterpartyId">
              @if (line.balance !== 0) {
                <span class="arrow" aria-hidden="true">{{ line.balance < 0 ? '→' : '←' }}</span>
              }
              <app-pictogram class="face" [picto]="faceOf(line)" [decorative]="true" />
              <span class="who">{{ nameOf(line) }}</span>
              <span class="sense">{{ senseOf(line) }}</span>
              @if (line.balance !== 0) {
                <strong class="amount">{{ money(abs(line.balance)) }}</strong>
                <app-banknotes class="notes" [amount]="abs(line.balance)" />
              }
            </a>
            <app-speaker-button class="listen" [phrase]="phraseOf(line)" label="Écouter" />
          </li>
        }
      </ul>
    }
  `,
  styles: `
    :host { display: block; }
    h1 { display: flex; align-items: center; gap: 8px; margin: 0 0 12px; font: 700 1.35rem var(--font-hand); color: var(--color-earth); }
    h1 app-pictogram { inline-size: 34px; block-size: 34px; }
    .totals { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-block-end: 14px; }
    .total {
      display: grid; justify-items: start; gap: 2px; padding: 10px 12px; background: var(--color-shell);
      border: 2px solid var(--color-card-edge); border-inline-start-width: 6px; border-radius: var(--radius-wobble-2); box-shadow: var(--shadow-hard-sm); font-weight: 700; color: var(--color-earth);
    }
    .total strong { font: 700 1.3rem var(--font-hand); color: var(--color-ink); font-variant-numeric: tabular-nums; }
    .total .arrow { font: 700 1.6rem/1 var(--font-hand); }
    .total.you-owe { border-inline-start-color: var(--color-alert); }
    .total.you-owe .arrow { color: var(--color-alert); }
    .total.owed { border-inline-start-color: var(--color-pasture); }
    .total.owed .arrow { color: var(--color-pasture); }
    .lines { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
    .line {
      position: relative; background: var(--color-shell); border: 2px solid var(--color-card-edge); border-inline-start-width: 6px;
      border-radius: var(--radius-wobble-2); box-shadow: var(--shadow-hard-sm);
    }
    .line.you-owe { border-inline-start-color: var(--color-alert); }
    .line.owed { border-inline-start-color: var(--color-pasture); }
    .line.settled { border-inline-start-color: var(--color-neutral); }
    .open {
      display: grid; grid-template-columns: 32px 44px 1fr auto; grid-template-areas: 'arrow face who amount' 'arrow face sense amount' 'notes notes notes notes';
      column-gap: 10px; row-gap: 4px; align-items: center; padding: 12px 14px; padding-inline-end: 64px; color: var(--color-ink); text-decoration: none;
    }
    .open .arrow { grid-area: arrow; font: 700 2rem/1 var(--font-hand); }
    .you-owe .open .arrow { color: var(--color-alert); }
    .owed .open .arrow { color: var(--color-pasture); }
    .face { grid-area: face; inline-size: 44px; block-size: 44px; }
    .who { grid-area: who; font: 700 1.05rem var(--font-hand); color: var(--color-earth); }
    .sense { grid-area: sense; font-weight: 700; }
    .you-owe .sense { color: var(--color-alert); }
    .owed .sense { color: var(--color-pasture); }
    .settled .sense { color: var(--color-muted); }
    .amount { grid-area: amount; font: 700 1.15rem var(--font-hand); white-space: nowrap; font-variant-numeric: tabular-nums; }
    .notes { grid-area: notes; }
    .listen { position: absolute; inset-block-start: 10px; inset-inline-end: 10px; }
    .none, .refusal { display: flex; align-items: center; gap: 10px; margin: 0 0 12px; }
    .none { color: var(--color-muted); font-style: italic; }
    .none app-pictogram, .refusal app-pictogram { inline-size: 26px; block-size: 26px; flex: none; }
    .refusal { padding: 10px 12px; border-inline-start: 5px solid var(--color-alert); background: var(--color-alert-light); color: var(--color-alert); font-weight: 700; }
    .open:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }
  `,
})
export class LedgerPage {
  protected readonly ledger = inject(Ledger);
  private readonly purchases = inject(Purchases);
  protected readonly abs = Math.abs;
  private readonly currency = computed(() => this.ledger.view()?.currency ?? this.purchases.currency() ?? '');

  constructor() {
    void this.ledger.load();
    void this.purchases.load();
  }

  protected money(amount: number): string {
    return amountWords(amount, this.currency());
  }

  protected faceOf(line: CounterpartyLedgerView): PictogramName {
    return (this.purchases.counterpartyById().get(line.counterpartyId)?.face ?? 'paper') as PictogramName;
  }

  protected nameOf(line: CounterpartyLedgerView): string {
    return this.purchases.counterpartyById().get(line.counterpartyId)?.name ?? 'Tiers';
  }

  protected senseOf(line: CounterpartyLedgerView): string {
    return line.balance < 0 ? 'tu dois' : line.balance > 0 ? 'il te doit' : 'soldé';
  }

  protected phraseOf(line: CounterpartyLedgerView): PhrasePart[] {
    return balancePhrase(line.balance);
  }

  protected totalPhrase(id: 'ledger-total-you-owe' | 'ledger-total-owed-to-you', amount: number): PhrasePart[] {
    return [clip(id), number(amount), clip('money-francs')];
  }
}
