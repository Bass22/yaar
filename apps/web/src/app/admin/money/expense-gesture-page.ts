import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, linkedSignal, signal, untracked, viewChild } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { PictogramName } from '@design-system';
import type { CostView, RecordCostRequest } from '@contracts';
import { recordCost, type CostContext } from '@domain/finance';
import type { BusinessDay } from '@domain/journal';
import type { CurrencyCode } from '@kit';
import { clip } from '../../core/audio/phrase';
import { Voice } from '../../core/audio/voice';
import { CLOCK } from '../../core/clock';
import { REDUCE_PHOTO } from '../../core/media/reduce-photo';
import { Keypad } from '../../ui/keypad';
import { Pictogram } from '../../ui/pictogram';
import { SpeakerButton } from '../../ui/speaker-button';
import { Stamp } from '../../ui/stamp';
import { Office } from '../office';
import { amountWords, Purchases } from '../purchases/purchases';
import { Banknotes } from './banknotes';
import { CATEGORY_PICTO, expenseReadBack, Expenses, type ExpenseProblem } from './expenses';

type Step = 'what' | 'howMuch' | 'readBack';

const WORDS: Partial<Record<ExpenseProblem, string>> = {
  NoLot: 'Choisis le lot.',
  NoType: 'Choisis pour quoi tu as dépensé.',
  NoAmount: 'Tape le montant, en francs.',
  InvalidAmount: 'Un montant en francs entiers, d’au moins 1 F.',
  NoCreditor: 'Choisis à qui tu dois.',
  SpentInFuture: 'La date ne peut pas être après aujourd’hui.',
  InvalidBusinessDay: 'La date n’est pas une date.',
  NoteTooLong: 'La note est trop longue : 2 000 caractères au plus.',
  CostTypeArchived: 'Ce type n’est plus utilisé.',
  UnknownCostType: 'Ce type n’est plus utilisé.',
  CounterpartyArchived: 'Ce tiers n’est plus disponible.',
  UnknownCounterparty: 'Ce tiers n’est plus disponible.',
  NotACreditor: 'On ne doit rien à un client par une dépense.',
  CampaignClosed: 'Ce lot est clos.',
  UnknownCampaign: 'Ce lot n’existe plus.',
  ReceiptRefused: 'La photo du reçu n’a pas été acceptée. Reprends-la, ou enregistre sans reçu.',
  NoNetwork: 'Pas de réseau : rien n’est enregistré. Réessaie avec le réseau.',
};
const SERVER_ERROR = 'Le serveur n’a pas pu enregistrer. Réessaie.';
const MAX_DIGITS = 9;

/**
 * Writing an expense (P.4, P.5; bureau-admin-v2.html screens 7 to 9): what for → how much, in
 * notes while typing → the read-back said aloud → Oui. Date, note and receipt behind « Plus de
 * détails », never required. Opened from a cost, it duplicates it (`from`, nothing written until
 * the Oui) or corrects it (`corrige`, a counter-entry). Online until the office's queue (P.7).
 */
@Component({
  selector: 'app-expense-gesture-page',
  imports: [Banknotes, Keypad, Pictogram, RouterLink, SpeakerButton, Stamp],
  providers: [Expenses],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="back" routerLink="../depenses" [queryParams]="{ lot: lotId() || null }">Annuler, revenir aux dépenses</a>
    @if (lots().length > 1) {
      <div class="lots" role="radiogroup" aria-label="Pour quel lot ?">
        @for (lot of lots(); track lot.campaignId) {
          <label class="lot">
            <input type="radio" name="lot" [checked]="lot.campaignId === lotId()" (change)="lotId.set(lot.campaignId)" />
            {{ lot.siteName }} · Jour {{ lot.campaignDay }}
          </label>
        }
      </div>
    } @else if (lotName(); as name) {
      <p class="for">Pour : {{ name }}</p>
    }

    @switch (step()) {
      @case ('what') {
        <h1>{{ correcting() ? 'Corriger la dépense' : 'Tu as dépensé pour quoi ?' }} <app-speaker-button phrase="cost-what" /></h1>
        <div class="types">
          @for (type of purchases.activeCostTypes(); track type.id) {
            <button type="button" class="type" [class.chosen]="type.id === typeId()" (click)="chooseType(type.id)">
              <app-pictogram [picto]="pictoOf(type.category)" [decorative]="true" />
              <span>{{ type.name }}</span>
            </button>
          }
        </div>
      }
      @case ('howMuch') {
        <h1 class="question"><app-pictogram [picto]="pictoOf(type()?.category)" [decorative]="true" /> {{ type()?.name }} : combien ?</h1>
        <p class="amount" aria-live="polite">{{ digits() === '' ? '—' : money(amount()) }}</p>
        <app-banknotes [amount]="amount()" />
        <app-keypad [thousands]="true" (digit)="typeDigit($event)" (erase)="eraseDigit()" />
        <div class="status" role="radiogroup" aria-label="Payé ou à payer ?">
          <label class="choice" [class.on]="paid()"><input type="radio" name="paid" [checked]="paid()" (change)="paid.set(true)" /> <app-pictogram picto="round-check" [decorative]="true" /> Payé</label>
          <label class="choice" [class.on]="!paid()"><input type="radio" name="paid" [checked]="!paid()" (change)="paid.set(false)" /> <app-pictogram picto="stamp-pending" [decorative]="true" /> À payer plus tard</label>
        </div>
        @if (!paid()) {
          <p class="ask">À qui ?</p>
          <div class="creditors">
            @for (creditor of purchases.creditors(); track creditor.id) {
              <button type="button" class="creditor" [class.chosen]="creditor.id === creditorId()" (click)="creditorId.set(creditor.id)">
                <app-pictogram [picto]="face(creditor.face)" [decorative]="true" />
                <span>{{ creditor.name }}</span>
              </button>
            }
          </div>
        }
        @if (problem(); as problem) {
          <p class="refusal" role="alert"><app-pictogram picto="cross" [decorative]="true" /> {{ problem }}</p>
        }
        <div class="actions">
          <button type="button" class="no" (click)="step.set('what')"><app-pictogram picto="cross" [decorative]="true" /> Retour</button>
          <button type="button" class="yes next" (click)="toReadBack()"><app-pictogram picto="check" [decorative]="true" /> Suivant</button>
        </div>
      }
      @case ('readBack') {
        <section class="receipt-card" aria-label="Relecture">
          <p class="what"><app-pictogram [picto]="pictoOf(type()?.category)" [decorative]="true" /> <b>{{ type()?.name }}</b> <small>{{ lotName() }}</small></p>
          <p class="amount">{{ money(amount()) }}</p>
          <app-banknotes [amount]="amount()" />
          <p class="how">{{ statusWords() }}</p>
          <app-speaker-button class="listen" [phrase]="readBack()" label="Écouter" />
        </section>
        <details class="details" [open]="detailsOpen()" (toggle)="detailsOpen.set($any($event.target).open)">
          <summary>Plus de détails : date, note, photo du reçu</summary>
          <label class="field"><span>Dépensé le</span><input name="spentOn" type="date" [value]="spentOn()" [max]="today()" (input)="spentOn.set(valueOf($event))" /></label>
          <label class="field"><span>Note</span><textarea name="note" rows="4" [value]="note()" (input)="note.set(valueOf($event))"></textarea></label>
          <div class="receipt">
            @if (receiptPreview(); as url) {
              <img [src]="url" alt="La photo du reçu" />
              <button type="button" class="link" (click)="forgetReceipt()">Retirer la photo</button>
            } @else if (keptReceipt()) {
              <p><app-pictogram picto="paper" [decorative]="true" /> Reçu ✓ (déjà joint)</p>
            } @else {
              <button type="button" class="photo" (click)="shootReceipt()"><app-pictogram picto="camera" [decorative]="true" /> Photo du reçu</button>
            }
            <input #camera class="camera" type="file" accept="image/*" capture="environment" tabindex="-1" aria-hidden="true" (change)="receiptTaken($event)" />
          </div>
        </details>
        @if (problem(); as problem) {
          <p class="refusal" role="alert"><app-pictogram picto="cross" [decorative]="true" /> {{ problem }}</p>
        }
        <div class="actions">
          <button type="button" class="no" (click)="backToAmount()"><app-pictogram picto="cross" [decorative]="true" /> Non</button>
          <button type="button" class="yes confirm" [disabled]="busy()" (click)="confirm()"><app-pictogram picto="check" [decorative]="true" /> Oui, c'est ça</button>
        </div>
      }
    }
    <app-stamp [shown]="stamped()" />
  `,
  styles: `
    :host { display: block; padding-block-end: 24px; }
    .back { display: inline-flex; align-items: center; min-block-size: 44px; color: var(--color-ink); font-weight: 700; }
    .for { margin: 0 0 8px; color: var(--color-muted); font-weight: 700; }
    .lots { display: flex; flex-wrap: wrap; gap: 8px; margin-block-end: 10px; }
    .lot { position: relative; padding: 8px 12px; border: 2px solid var(--color-card-edge); border-radius: 999px; font-weight: 700; color: var(--color-earth); cursor: pointer; }
    .lot input { position: absolute; inset: 0; opacity: 0; margin: 0; cursor: pointer; }
    .lot:has(input:checked) { border-color: var(--color-pasture); background: var(--color-pasture-light); }
    h1 { display: flex; align-items: center; gap: 8px; margin: 4px 0 12px; font: 700 1.3rem var(--font-hand); color: var(--color-earth); }
    h1 app-pictogram { inline-size: 34px; block-size: 34px; flex: none; }
    .types { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 10px; }
    .type, .creditor {
      display: grid; justify-items: center; align-content: center; gap: 6px; min-block-size: 96px; padding: 8px 4px; cursor: pointer;
      background: var(--color-shell); border: 3px solid var(--color-card-edge); border-radius: var(--radius-wobble-1); box-shadow: var(--shadow-hard-sm);
      font: 700 0.95rem var(--font-hand); color: var(--color-earth); text-align: center;
    }
    .type:nth-child(even), .creditor:nth-child(even) { border-radius: var(--radius-wobble-2); }
    .type app-pictogram, .creditor app-pictogram { inline-size: 44px; block-size: 44px; }
    .type.chosen, .creditor.chosen { border-color: var(--color-pasture); background: var(--color-pasture-light); }
    .amount { margin: 4px 0 8px; text-align: center; font: 700 2.4rem var(--font-hand); color: var(--color-ink); font-variant-numeric: tabular-nums; }
    app-banknotes { margin-block-end: 12px; }
    .status { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 14px 0 8px; }
    .choice {
      position: relative; display: flex; align-items: center; justify-content: center; gap: 6px; min-block-size: 52px; cursor: pointer;
      border: 3px solid var(--color-card-edge); border-radius: var(--radius-wobble-1); background: var(--color-paper); font: 700 1rem var(--font-hand); color: var(--color-earth);
    }
    .choice input { position: absolute; inset: 0; opacity: 0; margin: 0; cursor: pointer; }
    .choice app-pictogram { inline-size: 24px; block-size: 24px; }
    .choice.on { border-color: var(--color-pasture); background: var(--color-pasture-light); }
    .choice:has(input:focus-visible) { outline: var(--focus-ring); outline-offset: 2px; }
    .ask { margin: 8px 0 6px; font: 700 1.05rem var(--font-hand); color: var(--color-earth); }
    .creditors { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 10px; }
    .receipt-card {
      position: relative; padding: 14px; background: var(--color-shell); border: 2px solid var(--color-card-edge); border-radius: var(--radius-wobble-2); box-shadow: var(--shadow-hard-sm); text-align: center;
    }
    .receipt-card .what { display: flex; align-items: center; justify-content: center; gap: 8px; margin: 0; color: var(--color-earth); flex-wrap: wrap; }
    .receipt-card .what app-pictogram { inline-size: 40px; block-size: 40px; }
    .receipt-card .what b { font: 700 1.2rem var(--font-hand); }
    .receipt-card .what small { inline-size: 100%; color: var(--color-muted); }
    .how { margin: 8px 0 0; font: 700 1.05rem var(--font-hand); color: var(--color-earth); }
    .listen { display: inline-block; margin-block-start: 8px; }
    .details { margin: 14px 0 0; padding: 10px 12px; border: 2px dashed var(--color-card-edge); border-radius: 4px; }
    .details summary { min-block-size: 44px; display: flex; align-items: center; cursor: pointer; font-weight: 700; color: var(--color-earth); }
    .field { display: grid; gap: 4px; margin-block-start: 10px; font-weight: 700; color: var(--color-earth); }
    .field input, .field textarea {
      min-block-size: 48px; padding: 6px 12px; border: 2px solid var(--color-card-edge); border-radius: 4px; background: var(--color-paper); color: var(--color-ink); font: 1.05rem var(--font-reading);
    }
    .field textarea { background-image: var(--notebook-lines); line-height: 1.6; resize: vertical; }
    .receipt { margin-block-start: 10px; }
    .receipt img { display: block; inline-size: 100%; max-block-size: 40dvh; object-fit: contain; border: 3px solid var(--color-pasture); }
    .receipt p { display: flex; align-items: center; gap: 6px; font-weight: 700; color: var(--color-pasture); }
    .receipt p app-pictogram { inline-size: 24px; block-size: 24px; }
    .photo, .link { display: inline-flex; align-items: center; gap: 8px; min-block-size: 48px; padding: 0 14px; border: 2px dashed var(--color-card-edge); background: transparent; color: var(--color-ink); font-weight: 700; cursor: pointer; }
    .photo app-pictogram { inline-size: 26px; block-size: 26px; }
    .camera { position: absolute; inline-size: 1px; block-size: 1px; opacity: 0; pointer-events: none; }
    .refusal { display: flex; align-items: center; gap: 8px; margin: 12px 0 0; padding: 10px 12px; border-inline-start: 5px solid var(--color-alert); background: var(--color-alert-light); color: var(--color-alert); font-weight: 700; }
    .refusal app-pictogram { inline-size: 24px; block-size: 24px; flex: none; }
    /* Always in sight, above the bar of five: Non and Oui are never under the fold. */
    .actions {
      position: sticky; inset-block-end: var(--office-tabs-block-size, 0); z-index: 1; display: flex; gap: 12px;
      margin: 16px -16px 0; padding: 8px 16px; background: var(--color-paper); border-block-start: 2px dashed var(--color-card-edge);
    }
    .actions button {
      min-block-size: 60px; display: flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer;
      border: 3px solid var(--color-ink); border-radius: var(--radius-wobble-1); box-shadow: var(--shadow-hard); font: 700 1.15rem var(--font-hand);
    }
    .actions app-pictogram { inline-size: 26px; block-size: 26px; }
    .no { flex: 1; background: var(--color-neutral); color: var(--color-on-sign); }
    .yes { flex: 2; background: var(--color-pasture); color: var(--color-on-sign); }
    .yes:disabled { opacity: 0.6; cursor: wait; }
    button:focus-visible, a:focus-visible, input:focus-visible, textarea:focus-visible, summary:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }
  `,
})
export class ExpenseGesturePage {
  protected readonly purchases = inject(Purchases);
  private readonly office = inject(Office);
  private readonly expenses = inject(Expenses);
  private readonly voice = inject(Voice);
  private readonly clock = inject(CLOCK);
  private readonly reduce = inject(REDUCE_PHOTO);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly camera = viewChild<ElementRef<HTMLInputElement>>('camera');

  private readonly query = this.route.snapshot.queryParamMap;
  /** The cost duplicated (`from`) or corrected (`corrige`), once the money of its lot is read. */
  private readonly sourceId = this.query.get('corrige') ?? this.query.get('from');
  protected readonly correcting = computed(() => this.query.get('corrige') !== null);
  private readonly source = computed((): CostView | null => this.expenses.money()?.costs.find((cost) => cost.id === this.sourceId) ?? null);

  protected readonly lots = this.office.lots;
  protected readonly lotId = linkedSignal(() => this.query.get('lot') ?? (this.office.lots().length === 1 ? (this.office.lots()[0]?.campaignId ?? '') : ''));
  protected readonly lotName = computed(() => {
    const lot = this.office.lots().find((one) => one.campaignId === this.lotId());
    return lot === undefined ? null : `${lot.siteName} · Jour ${lot.campaignDay}`;
  });
  protected readonly today = computed(() => this.office.sites()[0]?.today ?? '');

  protected readonly step = signal<Step>('what');
  protected readonly typeId = signal('');
  protected readonly type = computed(() => this.purchases.costTypeById().get(this.typeId()) ?? null);
  protected readonly digits = signal('');
  protected readonly amount = computed(() => (this.digits() === '' ? 0 : Number(this.digits())));
  /** Paid is chosen for the admin (screen 8); « à payer » asks to whom. */
  protected readonly paid = signal(true);
  protected readonly creditorId = signal('');
  protected readonly spentOn = linkedSignal(() => this.today());
  protected readonly note = signal('');
  protected readonly detailsOpen = signal(false);
  protected readonly receiptPreview = signal<string | null>(null);
  /** A receipt the corrected cost already carries: kept unless replaced. */
  protected readonly keptReceipt = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly stamped = signal(false);
  protected readonly problem = signal<string | null>(null);
  private receiptBytes: Uint8Array | null = null;
  /** Made once: tried again after a failure, the same cost is sent, and the server keeps it once. */
  private readonly costId = crypto.randomUUID();

  protected readonly statusWords = computed(() => {
    if (this.paid()) return this.spentOn() === this.today() ? 'payé aujourd’hui' : `payé le ${dayWords(this.spentOn())}`;
    const creditor = this.purchases.counterpartyById().get(this.creditorId());
    return `à payer à ${creditor?.name ?? '…'}`;
  });
  protected readonly readBack = computed(() => expenseReadBack(this.type()?.category ?? 'Other', this.amount(), this.paid()));

  constructor() {
    void this.purchases.load();
    void this.voice.say([clip('cost-what')]);
    // A cost to duplicate or correct is read with the money of its lot, then fills the gesture once.
    effect(() => {
      const lot = this.lotId();
      if (this.sourceId !== null && lot !== '') untracked(() => void this.expenses.load(lot));
    });
    effect(() => {
      const source = this.source();
      if (source !== null) untracked(() => this.fillFrom(source));
    });
  }

  protected pictoOf(category: string | undefined): PictogramName {
    return CATEGORY_PICTO[category ?? 'Other'] ?? 'paper';
  }

  protected face(code: string): PictogramName {
    return code as PictogramName;
  }

  protected money(amount: number): string {
    return amountWords(amount, this.purchases.currency() ?? '');
  }

  protected valueOf(event: Event): string {
    return (event.target as HTMLInputElement | HTMLTextAreaElement).value;
  }

  protected chooseType(id: string): void {
    this.typeId.set(id);
    this.problem.set(null);
    this.step.set('howMuch');
    void this.voice.say([clip('cost-how-much')]);
  }

  protected typeDigit(digit: string): void {
    const next = (this.digits() + digit).replace(/^0+/, '');
    if (next.length <= MAX_DIGITS) this.digits.set(next);
  }

  protected eraseDigit(): void {
    this.digits.update((digits) => digits.slice(0, -1));
  }

  protected toReadBack(): void {
    if (this.amount() <= 0) return this.problem.set(WORDS.NoAmount ?? SERVER_ERROR);
    if (!this.paid() && this.creditorId() === '') return this.problem.set(WORDS.NoCreditor ?? SERVER_ERROR);
    this.problem.set(null);
    this.step.set('readBack');
    void this.voice.say(this.readBack());
  }

  protected backToAmount(): void {
    this.problem.set(null);
    this.step.set('howMuch');
  }

  protected shootReceipt(): void {
    const camera = this.camera()?.nativeElement;
    if (camera === undefined) return;
    camera.value = '';
    camera.click();
  }

  protected async receiptTaken(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file === undefined) return;
    try {
      this.receiptBytes = await this.reduce(file);
      this.receiptPreview.set(URL.createObjectURL(new Blob([this.receiptBytes as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' })));
    } catch {
      this.problem.set(WORDS.ReceiptRefused ?? SERVER_ERROR);
    }
  }

  protected forgetReceipt(): void {
    const url = this.receiptPreview();
    if (url !== null) URL.revokeObjectURL(url);
    this.receiptPreview.set(null);
    this.receiptBytes = null;
  }

  protected async confirm(): Promise<void> {
    const currency = this.purchases.currency();
    if (this.busy() || currency === null) return;
    if (this.lotId() === '') return this.problem.set(WORDS.NoLot ?? SERVER_ERROR);
    const request: RecordCostRequest = {
      id: this.costId,
      campaignId: this.lotId(),
      costTypeId: this.typeId(),
      spentOn: this.spentOn(),
      amount: this.amount(),
      note: this.note().trim() === '' ? null : this.note(),
      payment: this.paid() ? { kind: 'Paid' } : { kind: 'ToPay', counterpartyId: this.creditorId() },
      receipt: this.keptReceipt(),
    };
    // The same rule as the server's, so that a refusal is said before anything leaves.
    const judged = recordCost({ ...request, recordedAt: this.clock.now().toISOString() }, this.contextOf(currency));
    if (!judged.ok) return this.problem.set(WORDS[judged.error.kind] ?? SERVER_ERROR);
    this.busy.set(true);
    this.problem.set(null);
    try {
      let receipt = request.receipt;
      if (this.receiptBytes !== null) {
        const sent = await this.expenses.sendReceipt(this.receiptBytes);
        if ('problem' in sent) return this.problem.set(WORDS[sent.problem] ?? SERVER_ERROR);
        receipt = sent.fingerprint;
      }
      const problem = await this.expenses.save({ ...request, receipt }, this.correcting() ? this.sourceId : null);
      if (problem !== null) return this.problem.set(WORDS[problem] ?? SERVER_ERROR);
      this.stamped.set(true);
      void this.voice.say([clip('written-thanks')]);
      await this.router.navigate(['../depenses'], { relativeTo: this.route, queryParams: { lot: this.lotId() } });
    } finally {
      this.busy.set(false);
    }
  }

  private contextOf(currency: string): CostContext {
    return {
      currency: currency as CurrencyCode,
      today: this.today() as BusinessDay,
      costTypes: [...this.purchases.costTypeById().values()].map(({ id, archived }) => ({ id, archived })),
      counterparties: [...this.purchases.counterpartyById().values()].map(({ id, kind, archived }) => ({ id, kind, archived })),
    };
  }

  /** Duplicating keeps what was spent and how, at today's date; correcting keeps everything. */
  private fillFrom(source: CostView): void {
    this.typeId.set(source.costTypeId);
    this.digits.set(String(source.amount));
    this.paid.set(source.payment.kind === 'Paid');
    this.creditorId.set(source.payment.kind === 'ToPay' ? source.payment.counterpartyId : '');
    this.note.set(source.note ?? '');
    if (this.correcting()) {
      this.spentOn.set(source.spentOn);
      this.keptReceipt.set(source.receipt);
    }
    this.step.set('howMuch');
  }
}

const dayWords = (day: string): string => {
  const [year, month, date] = day.split('-');
  return `${date}/${month}/${year}`;
};
