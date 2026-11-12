import { ChangeDetectionStrategy, Component, computed, effect, inject, linkedSignal, signal, untracked } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { PictogramName } from '@design-system';
import type { LedgerEntryView, PaymentMethodCode, RecordSettlementRequest, SettlementDirectionCode } from '@contracts';
import { recordSettlement } from '@domain/finance';
import type { BusinessDay } from '@domain/journal';
import type { CurrencyCode } from '@kit';
import { clip, number } from '../../../core/audio/phrase';
import { Voice } from '../../../core/audio/voice';
import { Pictogram } from '../../../ui/pictogram';
import { SpeakerButton } from '../../../ui/speaker-button';
import { Stamp } from '../../../ui/stamp';
import { FiguresAge } from '../../figures-age';
import { OfficePending } from '../../office-pending';
import { OfficeSync } from '../../office-sync';
import { Office } from '../../office';
import { METHODS } from '../../purchases/payment-page';
import { FEE_REFUSAL, FeeField, feeCost, feeTypeOf, takesFee, TransferFees } from '../transfer-fee';
import { amountWords, Purchases } from '../../purchases/purchases';
import { Banknotes } from '../banknotes';
import { balancePhrase, Ledger, type SettlementProblem } from './ledger';

const WORDS: Partial<Record<SettlementProblem, string>> = {
  NoMethod: 'Choisis comment tu as réglé.',
  InvalidAmount: 'Un montant en francs entiers, d’au moins 1 F.',
  PaidInFuture: 'La date ne peut pas être après aujourd’hui.',
  InvalidBusinessDay: 'La date n’est pas une date.',
  CounterpartyArchived: 'Ce tiers n’est plus disponible.',
  UnknownCounterparty: 'Ce tiers n’est plus disponible.',
  NoNetwork: 'Pas de réseau : rien n’est réglé. Réessaie avec le réseau.',
  StorageUnavailable: 'L’appareil n’arrive pas à garder ce règlement. Réessaie, ou appelle le support.',
};
const SERVER_ERROR = 'Le serveur n’a pas pu enregistrer le règlement. Réessaie.';

/** What each entry of the ledger is, in words. */
function entryWords(entry: LedgerEntryView): string {
  switch (entry.source.kind) {
    case 'OrderReceived':
      return 'Commande reçue';
    case 'OrderPayment':
      return 'Paiement de commande';
    case 'OrderPaidBy':
      return 'A payé une commande pour toi';
    case 'Cost':
      return entry.source.paidBy === true ? 'A payé une dépense pour toi' : 'Dépense à payer';
    case 'Settlement':
      return entry.source.direction === 'ToCounterparty' ? 'Règlement donné' : 'Règlement reçu';
    case 'Sale':
      return 'Vente';
    case 'SaleReceipt':
      return 'Encaissement de vente';
  }
}

// One counterparty's ledger (R.3): its balance in words, arrow, colour and notes; every entry,
// dated, in both directions; then « Régler » — the debt offered as the amount, today's date, the
// way of paying on tiles, never chosen ahead. The server sums; the screen adds nothing up.
@Component({
  selector: 'app-counterparty-ledger-page',
  imports: [FeeField, Banknotes, FiguresAge, OfficePending, Pictogram, RouterLink, SpeakerButton, Stamp],
  providers: [Ledger],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="back" routerLink="..">Revenir à qui doit quoi</a>
    <h1><app-pictogram [picto]="face()" [decorative]="true" /> {{ name() }}</h1>
    <app-figures-age [readAt]="ledger.readAt()" [stale]="ledger.unreachable()" />
    <app-office-pending [kinds]="['settlement']" [subject]="counterpartyId" />
    @if (line(); as line) {
      <section class="balance" [class.you-owe]="line.balance < 0" [class.owed]="line.balance > 0" aria-label="Le solde">
        @if (line.balance !== 0) {
          <span class="arrow" aria-hidden="true">{{ line.balance < 0 ? '→' : '←' }}</span>
        }
        <span class="sense">{{ line.balance < 0 ? 'Tu dois' : line.balance > 0 ? 'Il te doit' : 'Soldé : personne ne doit rien' }}</span>&ngsp;
        @if (line.balance !== 0) {
          <strong>{{ money(abs(line.balance)) }}</strong>
          <app-banknotes [amount]="abs(line.balance)" />
        }
        <app-speaker-button [phrase]="phrase()" label="Écouter" />
      </section>
      <ul class="entries" aria-label="Le grand livre">
        @for (entry of line.entries; track $index) {
          <li>
            <span>{{ day(entry.on) }}</span>&ngsp;<span>{{ words(entry) }}</span>&ngsp;<strong [class.minus]="entry.amount < 0">{{ entry.amount < 0 ? '−' : '+' }} {{ money(abs(entry.amount)) }}</strong>
          </li>
        }
      </ul>
    } @else if (ledger.view() !== null) {
      <p class="none">Aucune écriture avec ce tiers.</p>
    }

    <section class="settle" aria-label="Régler">
      <h2>Régler</h2>
      <div class="direction" role="radiogroup" aria-label="Dans quel sens ?">
        <label class="choice" [class.on]="direction() === 'ToCounterparty'"><input type="radio" name="direction" [checked]="direction() === 'ToCounterparty'" (change)="direction.set('ToCounterparty')" /> → Tu lui as donné</label>
        <label class="choice" [class.on]="direction() === 'FromCounterparty'"><input type="radio" name="direction" [checked]="direction() === 'FromCounterparty'" (change)="direction.set('FromCounterparty')" /> ← Il t’a donné</label>
      </div>
      <div class="when">
        <label class="field"><span>Combien ?</span><input name="amount" type="number" inputmode="numeric" min="1" step="1" [value]="amount()" (input)="amount.set(valueOf($event))" /></label>
        <label class="field"><span>Le</span><input name="paidOn" type="date" [value]="paidOn()" [max]="today()" (input)="paidOn.set(valueOf($event))" /></label>
      </div>
      <div class="methods" role="radiogroup" aria-label="Comment ?">
        @for (one of methods; track one.code) {
          <label class="method" [class]="'method method-' + one.tone">
            <input type="radio" name="method" [checked]="one.code === method()" (change)="method.set(one.code)" />
            <app-pictogram [picto]="one.picto" [decorative]="true" />
            <span>{{ one.words }}</span>
          </label>
        }
      </div>
      <!-- A settlement belongs to no flock: its fee is carried by a running lot (P.8). -->
      <app-fee-field [method]="method()" [available]="feeType() !== null && lots().length > 0" [(value)]="fee" />
      @if (feeShown() && lots().length > 1) {
        <div class="fee-lots" role="radiogroup" aria-label="Quel lot porte les frais ?">
          <p>Quel lot porte les frais ?</p>
          @for (lot of lots(); track lot.campaignId) {
            <label class="fee-lot" [class.on]="lot.campaignId === feeLot()">
              <input type="radio" name="feeLot" [checked]="lot.campaignId === feeLot()" (change)="feeLot.set(lot.campaignId)" />
              {{ lot.siteName }} · Jour {{ lot.campaignDay }}
            </label>
          }
        </div>
      }
      @if (problem(); as problem) {
        <p class="refusal" role="alert"><app-pictogram picto="cross" [decorative]="true" /> {{ problem }}</p>
      }
      <button type="button" class="go" [disabled]="busy()" (click)="settle()"><app-pictogram picto="check" [decorative]="true" /> Régler</button>
    </section>
    <app-stamp [shown]="stamped()" />
  `,
  styles: `
    :host { display: block; padding-block-end: 16px; }
    .back { display: inline-flex; align-items: center; min-block-size: 44px; color: var(--color-ink); font-weight: 700; }
    h1 { display: flex; align-items: center; gap: 10px; margin: 4px 0 12px; font: 700 1.35rem var(--font-hand); color: var(--color-earth); }
    h1 app-pictogram { inline-size: 44px; block-size: 44px; }
    .balance {
      display: grid; justify-items: center; gap: 6px; padding: 14px; text-align: center; background: var(--color-shell);
      border: 2px solid var(--color-card-edge); border-block-start-width: 6px; border-radius: var(--radius-wobble-2); box-shadow: var(--shadow-hard-sm); font-weight: 700; color: var(--color-earth);
    }
    .balance .arrow { font: 700 2.4rem/1 var(--font-hand); }
    .balance strong { font: 700 2rem var(--font-hand); color: var(--color-ink); font-variant-numeric: tabular-nums; }
    .balance.you-owe { border-block-start-color: var(--color-alert); }
    .balance.you-owe .arrow, .balance.you-owe .sense { color: var(--color-alert); }
    .balance.owed { border-block-start-color: var(--color-pasture); }
    .balance.owed .arrow, .balance.owed .sense { color: var(--color-pasture); }
    .entries { list-style: none; margin: 14px 0; padding: 0; }
    .entries li { display: grid; grid-template-columns: auto 1fr auto; gap: 10px; padding: 8px 2px; border-block-end: 1px dashed var(--color-card-edge); color: var(--color-earth); }
    .entries strong { color: var(--color-pasture); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .entries strong.minus { color: var(--color-alert); }
    .none { color: var(--color-muted); font-style: italic; }
    .settle { margin-block-start: 18px; padding: 12px; border: 2px dashed var(--color-card-edge); border-radius: 4px; display: grid; gap: 12px; }
    h2 { margin: 0; font: 700 1.15rem var(--font-hand); color: var(--color-earth); }
    .direction { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .choice {
      position: relative; display: flex; align-items: center; justify-content: center; min-block-size: 52px; padding: 0 6px; cursor: pointer; text-align: center;
      border: 3px solid var(--color-card-edge); border-radius: var(--radius-wobble-1); background: var(--color-paper); font: 700 0.95rem var(--font-hand); color: var(--color-earth);
    }
    .choice input { position: absolute; inset: 0; opacity: 0; margin: 0; cursor: pointer; }
    .choice.on { border-color: var(--color-pasture); background: var(--color-pasture-light); }
    .when { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; }
    .field { display: grid; gap: 4px; font-weight: 700; color: var(--color-earth); }
    .field input { min-block-size: 48px; padding: 0 12px; border: 2px solid var(--color-card-edge); border-radius: 4px; background: var(--color-paper); color: var(--color-ink); font: 1.1rem var(--font-reading); min-inline-size: 0; }
    .field input[name='amount'] { font: 700 1.3rem var(--font-hand); text-align: end; }
    .methods { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .method {
      position: relative; display: grid; justify-items: center; align-content: center; gap: 4px; min-block-size: 84px; cursor: pointer; text-align: center;
      background: var(--color-shell); border: 3px solid var(--color-card-edge); border-block-end-width: 6px; border-radius: var(--radius-wobble-1); font: 700 0.9rem var(--font-hand); color: var(--color-earth);
    }
    .method input { position: absolute; inset: 0; opacity: 0; margin: 0; cursor: pointer; }
    .method app-pictogram { inline-size: 36px; block-size: 36px; }
    .method-cash { border-block-end-color: var(--color-corn); }
    .method-wave { border-block-end-color: var(--color-blue); }
    .method-orange { border-block-end-color: var(--color-orange); }
    .method:has(input:checked) { border-color: var(--color-pasture); background: var(--color-pasture-light); }
    .choice:has(input:focus-visible), .method:has(input:focus-visible) { outline: var(--focus-ring); outline-offset: 2px; }
    .refusal { display: flex; align-items: center; gap: 8px; margin: 0; padding: 10px 12px; border-inline-start: 5px solid var(--color-alert); background: var(--color-alert-light); color: var(--color-alert); font-weight: 700; }
    .refusal app-pictogram { inline-size: 24px; block-size: 24px; flex: none; }
    .go {
      display: flex; align-items: center; justify-content: center; gap: 8px; min-block-size: 56px; cursor: pointer;
      border: 3px solid var(--color-ink); border-radius: var(--radius-wobble-1); box-shadow: var(--shadow-hard); background: var(--color-pasture); color: var(--color-on-sign); font: 700 1.15rem var(--font-hand);
    }
    .go app-pictogram { inline-size: 24px; block-size: 24px; }
    .fee-lots { display: flex; flex-wrap: wrap; gap: 8px; }
    .fee-lots p { flex-basis: 100%; margin: 0; font-weight: 700; color: var(--color-earth); }
    .fee-lot { position: relative; padding: 8px 12px; border: 2px solid var(--color-card-edge); border-radius: 999px; font-weight: 700; color: var(--color-earth); cursor: pointer; }
    .fee-lot input { position: absolute; inset: 0; opacity: 0; margin: 0; cursor: pointer; }
    .fee-lot.on { border-color: var(--color-pasture); background: var(--color-pasture-light); }
    .fee-lot:has(input:focus-visible) { outline: var(--focus-ring); outline-offset: 2px; }
    .go:disabled { opacity: 0.6; }
    a:focus-visible, button:focus-visible, input:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }
  `,
})
export class CounterpartyLedgerPage {
  protected readonly ledger = inject(Ledger);
  private readonly purchases = inject(Purchases);
  private readonly office = inject(Office);
  private readonly voice = inject(Voice);
  private readonly route = inject(ActivatedRoute);

  protected readonly counterpartyId = this.route.snapshot.paramMap.get('id') ?? '';
  private readonly officeSync = inject(OfficeSync);
  protected readonly methods = METHODS;
  protected readonly abs = Math.abs;
  protected readonly line = computed(() => this.ledger.view()?.counterparties.find((one) => one.counterpartyId === this.counterpartyId) ?? null);
  private readonly counterparty = computed(() => this.purchases.counterpartyById().get(this.counterpartyId) ?? null);
  protected readonly name = computed(() => this.counterparty()?.name ?? 'Tiers');
  protected readonly face = computed(() => (this.counterparty()?.face ?? 'paper') as PictogramName);
  protected readonly phrase = computed(() => balancePhrase(this.line()?.balance ?? 0));
  protected readonly today = computed(() => this.office.sites()[0]?.today ?? '');

  /** You owe it: you give; it owes you: it gives back. What is owed is offered. */
  protected readonly direction = linkedSignal<SettlementDirectionCode>(() => ((this.line()?.balance ?? 0) > 0 ? 'FromCounterparty' : 'ToCounterparty'));
  protected readonly amount = linkedSignal(() => {
    const balance = this.line()?.balance ?? 0;
    return balance === 0 ? '' : String(Math.abs(balance));
  });
  protected readonly paidOn = linkedSignal(() => this.today());
  /** Never chosen ahead. */
  protected readonly method = signal<PaymentMethodCode | null>(null);
  protected readonly busy = signal(false);
  protected readonly stamped = signal(false);
  protected readonly problem = signal<string | null>(null);
  /** Made once: tried again after a failure, the same settlement is sent, kept once. */
  private settlementId = crypto.randomUUID();
  /** The Wave or Orange Money fee the farm paid (P.8), the lot that carries it — the only one, or chosen — and its expense's identifier. */
  protected readonly fee = signal('');
  protected readonly lots = this.office.lots;
  protected readonly feeLot = linkedSignal<string | null>(() => (this.office.lots().length === 1 ? (this.office.lots()[0]?.campaignId ?? null) : null));
  protected readonly feeType = computed(() => feeTypeOf(this.purchases.activeCostTypes()));
  protected readonly feeShown = computed(() => takesFee(this.method()) && this.feeType() !== null && this.lots().length > 0);
  private feeId = crypto.randomUUID();
  private readonly fees = inject(TransferFees);

  constructor() {
    void this.purchases.load();
    effect(() => {
      this.officeSync.revision();
      untracked(() => void this.ledger.load());
    });
  }

  protected money(amount: number): string {
    return amountWords(amount, this.ledger.view()?.currency ?? this.purchases.currency() ?? '');
  }

  protected day(on: string): string {
    const [year, month, date] = on.split('-');
    return `${date}/${month}/${year}`;
  }

  protected words(entry: LedgerEntryView): string {
    return entryWords(entry);
  }

  protected valueOf(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected async settle(): Promise<void> {
    const currency = this.purchases.currency();
    if (this.busy() || currency === null) return;
    const method = this.method();
    if (method === null) return this.problem.set(WORDS.NoMethod ?? SERVER_ERROR);
    const request: RecordSettlementRequest = {
      id: this.settlementId,
      counterpartyId: this.counterpartyId,
      paidOn: this.paidOn(),
      amount: this.amount().trim() === '' ? Number.NaN : Number(this.amount()),
      method,
      direction: this.direction(),
    };
    // The same rule as the server's, so that a refusal is said before anything leaves.
    const judged = recordSettlement(request, {
      currency: currency as CurrencyCode,
      today: this.today() as BusinessDay,
      counterparties: [...this.purchases.counterpartyById().values()].map(({ id, archived }) => ({ id, archived })),
    });
    if (!judged.ok) return this.problem.set(WORDS[judged.error.kind === 'InvalidId' ? 'ServerError' : judged.error.kind] ?? SERVER_ERROR);
    const fee = feeCost({
      id: this.feeId,
      typed: this.feeShown() ? this.fee() : '',
      method,
      campaignId: this.feeLot() ?? '',
      costTypeId: this.feeType(),
      on: request.paidOn,
      about: `${request.direction === 'ToCounterparty' ? 'règlement' : 'reçu de'} ${this.name()}`,
    });
    if (fee.kind === 'invalid') return this.problem.set(FEE_REFUSAL);
    if (fee.kind === 'cost' && this.feeLot() === null) return this.problem.set('Choisis le lot qui porte les frais.');
    this.busy.set(true);
    this.problem.set(null);
    const problem = await this.ledger.settle(request);
    // The fee after its settlement: the settlement keeps its whole amount, the fee is the lot's expense.
    const feeKept = problem === null && fee.kind === 'cost' ? await this.fees.keep(fee.request) : true;
    this.busy.set(false);
    if (problem !== null) return this.problem.set(WORDS[problem] ?? SERVER_ERROR);
    if (!feeKept) return this.problem.set(WORDS.StorageUnavailable ?? SERVER_ERROR);
    void this.voice.say([clip(request.direction === 'ToCounterparty' ? 'settle-to' : 'settle-from'), number(request.amount), clip('money-francs')]);
    this.stamped.set(true);
    setTimeout(() => this.stamped.set(false), 1500);
    // A new settlement gets a new identifier; the ledger is read again.
    this.settlementId = crypto.randomUUID();
    this.feeId = crypto.randomUUID();
    this.fee.set('');
    this.method.set(null);
  }
}
