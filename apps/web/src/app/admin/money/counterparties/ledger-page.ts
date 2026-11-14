import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { PictogramName } from '@design-system';
import type { CounterpartyFaceCode, CounterpartyKindCode, CounterpartyLedgerView } from '@contracts';
import { clip, number, type PhrasePart } from '../../../core/audio/phrase';
import { Pictogram } from '../../../ui/pictogram';
import { SpeakerButton } from '../../../ui/speaker-button';
import { FiguresAge } from '../../figures-age';
import { OfficePending } from '../../office-pending';
import { OfficeSync } from '../../office-sync';
import { amountWords, Purchases } from '../../purchases/purchases';
import { Banknotes } from '../banknotes';
import { balancePhrase, Ledger } from './ledger';
import { typedText } from '../../typed-number';

/** The sorts of counterparty, and the faces each one is offered (R.7; demands of 2026-11-13). */
const KINDS: readonly { readonly kind: CounterpartyKindCode; readonly word: string }[] = [
  { kind: 'Supplier', word: 'Fournisseur' },
  { kind: 'Customer', word: 'Acheteur' },
  { kind: 'Collaborator', word: 'Collaborateur' },
];
const FACES: Readonly<Record<CounterpartyKindCode, readonly { readonly face: CounterpartyFaceCode; readonly word: string }[]>> = {
  Supplier: [
    { face: 'closed-bag', word: 'Aliment' },
    { face: 'chick', word: 'Poussins' },
    { face: 'syringe', word: 'Véto' },
  ],
  Customer: [
    { face: 'caretaker', word: 'Une personne' },
    { face: 'shop', word: 'Une entreprise' },
  ],
  Collaborator: [{ face: 'caretaker', word: 'Une personne' }],
};

// « Qui doit quoi » (R.3; bureau-admin-v2.html screens 5 and 10): what you owe and what is owed
// to you, summed by the server; then one line per counterparty — its face, its name, the direction
// seen without reading (a red arrow from you to it, a green one back to you, and the words), the
// amount in notes. A settled counterparty carries no arrow. Touching a line opens its ledger.
@Component({
  selector: 'app-ledger-page',
  imports: [Banknotes, FiguresAge, OfficePending, Pictogram, RouterLink, SpeakerButton],
  providers: [Ledger],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1><app-pictogram picto="coin" [decorative]="true" /> Qui doit quoi</h1>
    <app-figures-age [readAt]="ledger.readAt()" [stale]="ledger.unreachable()" />
    <app-office-pending [kinds]="['settlement', 'payment', 'cost']" />
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
              @if (partlyAhead(line); as ahead) {
                <small class="ahead">dont {{ money(ahead) }} payés d’avance, à livrer</small>
              }
            </a>
            <app-speaker-button class="listen" [phrase]="phraseOf(line)" label="Écouter" />
          </li>
        }
      </ul>
      @if (others().length > 0) {
        <section class="others" aria-label="Les autres tiers">
          <h2>Les autres tiers</h2>
          @for (one of others(); track one.id) {
            <a [routerLink]="one.id">{{ one.name }}</a>
          }
        </section>
      }
      @if (adding()) {
        <form class="new-counterparty" (submit)="create($event)">
          <div class="kinds" role="radiogroup" aria-label="Sa sorte">
            @for (choice of kinds; track choice.kind) {
              <label class="chip"><input type="radio" name="kind" [value]="choice.kind" [checked]="newKind() === choice.kind" (change)="chooseKind(choice.kind)" /> {{ choice.word }}</label>
            }
          </div>
          <label class="field"><span>Son nom</span><input name="counterpartyName" type="text" maxlength="60" [value]="newName()" (input)="newName.set(valueOf($event))" /></label>
          <div class="new-faces" role="radiogroup" aria-label="Son visage">
            @for (choice of facesOf(newKind()); track choice.face) {
              <label class="chip"><input type="radio" name="face" [value]="choice.face" [checked]="newFace() === choice.face" (change)="newFace.set(choice.face)" /><app-pictogram [picto]="choice.face" [decorative]="true" /> {{ choice.word }}</label>
            }
          </div>
          <label class="advances"><input type="checkbox" name="advancesExpenses" [checked]="newAdvances()" (change)="newAdvances.set(!newAdvances())" /> Peut avancer des frais pour l’élevage</label>
          @if (problem(); as said) {
            <p class="refusal" role="alert">{{ said }}</p>
          }
          <button type="submit" class="create">Ajouter ce tiers</button>
        </form>
      } @else {
        <button type="button" class="add-counterparty" (click)="adding.set(true)">Ajouter un tiers</button>
      }
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
      display: grid; grid-template-columns: 32px 44px minmax(0, 1fr); grid-template-areas: 'arrow face who' 'arrow face sense' 'arrow face amount' 'ahead ahead ahead' 'notes notes notes';
      column-gap: 10px; row-gap: 4px; align-items: center; padding: 12px 12px; padding-inline-end: 60px; color: var(--color-ink); text-decoration: none;
    }
    .open .arrow { grid-area: arrow; font: 700 2rem/1 var(--font-hand); }
    .you-owe .open .arrow { color: var(--color-alert); }
    .owed .open .arrow { color: var(--color-pasture); }
    .face { grid-area: face; inline-size: 44px; block-size: 44px; }
    .who { grid-area: who; font: 700 1.05rem var(--font-hand); color: var(--color-earth); }
    .sense { grid-area: sense; font-weight: 700; }
    .others { display: flex; flex-wrap: wrap; gap: 6px 14px; margin: 12px 0; }
    .others h2 { flex-basis: 100%; margin: 0; font: 700 1rem var(--font-hand); color: var(--color-earth); }
    .others a { display: inline-flex; align-items: center; min-block-size: 44px; color: var(--color-ink); font-weight: 700; }
    .add-counterparty, .create { min-block-size: 48px; padding: 0 16px; margin-block: 10px; border: 2px solid var(--color-ink); border-radius: var(--radius-wobble-1); background: var(--color-pasture); color: var(--color-on-sign); font-weight: 700; cursor: pointer; }
    .new-counterparty { display: grid; gap: 10px; padding: 12px; margin-block: 10px; background: var(--color-shell); border: 2px dashed var(--color-card-edge); border-radius: 4px; }
    .kinds, .new-faces { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip { position: relative; display: inline-flex; align-items: center; gap: 6px; min-block-size: 44px; padding: 0 12px; border: 2px solid var(--color-card-edge); border-radius: var(--radius-wobble-1); background: var(--color-paper); color: var(--color-ink); font-weight: 700; cursor: pointer; }
    .chip input { position: absolute; inset: 0; margin: 0; opacity: 0; cursor: pointer; }
    .chip app-pictogram { inline-size: 24px; block-size: 24px; }
    .chip:has(input:checked) { border-color: var(--color-pasture); background: var(--color-pasture); color: var(--color-on-sign); }
    .new-counterparty .field { display: grid; gap: 4px; font-weight: 700; }
    .new-counterparty .field input { min-block-size: 44px; padding: 0 8px; border: 2px solid var(--color-card-edge); border-radius: 4px; background: var(--color-paper); color: var(--color-ink); font: 700 1.05rem var(--font-hand); }
    .advances { display: flex; align-items: center; gap: 8px; min-block-size: 44px; font-weight: 700; color: var(--color-ink); }
    .advances input { inline-size: 24px; block-size: 24px; }
    .refusal { margin: 0; padding: 8px 10px; border-inline-start: 4px solid var(--color-alert); background: var(--color-orange-light); color: var(--color-ink); font-weight: 700; }
    .ahead { grid-area: ahead; color: var(--color-muted); }
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

  private readonly officeSync = inject(OfficeSync);

  protected readonly kinds = KINDS;
  protected readonly adding = signal(false);
  protected readonly newKind = signal<CounterpartyKindCode>('Supplier');
  protected readonly newName = signal('');
  protected readonly newFace = signal<CounterpartyFaceCode>('closed-bag');
  protected readonly newAdvances = signal(false);
  protected readonly problem = signal<string | null>(null);

  /** The counterparties in use without any entry yet: not in the ledger, still reachable (R.7). */
  protected readonly others = computed(() => {
    const inLedger = new Set((this.ledger.view()?.counterparties ?? []).map(({ counterpartyId }) => counterpartyId));
    return [...this.purchases.counterpartyById().values()].filter((one) => !one.archived && !inLedger.has(one.id)).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  });

  constructor() {
    void this.purchases.load();
    effect(() => {
      this.officeSync.revision();
      untracked(() => void this.ledger.load());
    });
  }

  protected money(amount: number): string {
    return amountWords(amount, this.currency());
  }

  protected facesOf(kind: CounterpartyKindCode) {
    return FACES[kind];
  }

  protected chooseKind(kind: CounterpartyKindCode): void {
    this.newKind.set(kind);
    this.newFace.set(FACES[kind][0]?.face ?? 'paper');
  }

  protected valueOf(event: Event): string {
    return typedText(event);
  }

  protected async create(event: Event): Promise<void> {
    event.preventDefault();
    if (this.newName().trim() === '') return this.problem.set('Écris son nom.');
    const created = await this.purchases.createCounterparty(this.newName(), this.newFace(), this.newKind(), this.newAdvances());
    if ('problem' in created) return this.problem.set(created.problem === 'NoNetwork' ? 'Ajouter un tiers demande le réseau.' : 'Le tiers n’a pas été ajouté.');
    this.problem.set(null);
    this.adding.set(false);
    this.newName.set('');
    this.newAdvances.set(false);
  }

  protected faceOf(line: CounterpartyLedgerView): PictogramName {
    return (this.purchases.counterpartyById().get(line.counterpartyId)?.face ?? 'paper') as PictogramName;
  }

  protected nameOf(line: CounterpartyLedgerView): string {
    return this.purchases.counterpartyById().get(line.counterpartyId)?.name ?? 'Tiers';
  }

  protected senseOf(line: CounterpartyLedgerView): string {
    // Paid before delivering, a supplier holds goods to come, not money to claim (R.8).
    if (line.balance > 0 && (line.paidAhead ?? 0) >= line.balance) return 'payé d’avance, à livrer';
    return line.balance < 0 ? 'tu dois' : line.balance > 0 ? 'il te doit' : 'soldé';
  }

  /** The part paid ahead, when it is only a part of what it owes (R.8); `null` otherwise. */
  protected partlyAhead(line: CounterpartyLedgerView): number | null {
    const ahead = line.paidAhead ?? 0;
    return ahead > 0 && ahead < line.balance ? ahead : null;
  }

  protected phraseOf(line: CounterpartyLedgerView): PhrasePart[] {
    return balancePhrase(line.balance);
  }

  protected totalPhrase(id: 'ledger-total-you-owe' | 'ledger-total-owed-to-you', amount: number): PhrasePart[] {
    return [clip(id), number(amount), clip('money-francs')];
  }
}
