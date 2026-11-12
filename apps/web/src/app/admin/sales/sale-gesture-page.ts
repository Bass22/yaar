import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { PictogramName } from '@design-system';
import type { CounterpartyFaceCode, PaymentMethodCode, RecordSaleRequest } from '@contracts';
import { recordSale, recordSaleReceipt, type SaleContext } from '@domain/finance';
import type { BusinessDay } from '@domain/journal';
import type { CurrencyCode } from '@kit';
import { clip, number, type PhrasePart } from '../../core/audio/phrase';
import { Voice } from '../../core/audio/voice';
import { CLOCK } from '../../core/clock';
import { Pictogram } from '../../ui/pictogram';
import { SpeakerButton } from '../../ui/speaker-button';
import { Banknotes } from '../money/banknotes';
import { Office } from '../office';
import { FEE_REFUSAL, FeeField, feeCost, feeTypeOf, TransferFees } from '../money/transfer-fee';
import { METHODS } from '../purchases/payment-page';
import { amountWords, Purchases } from '../purchases/purchases';
import { Sales, type SaleProblem } from './sales';

type Step = 'whom' | 'howMany' | 'paid' | 'readBack';
type Paid = 'all' | 'part' | 'none';

const WORDS: Partial<Record<SaleProblem, string>> = {
  NoBuyer: 'Choisis l’acheteur.',
  NoBirds: 'Combien de poulets ? Au moins un.',
  InvalidBirds: 'Combien de poulets ? Au moins un, sans virgule.',
  NoPrice: 'Mets le prix.',
  InvalidPrice: 'Un prix en francs entiers, d’au moins 1 F.',
  InvalidWeight: 'Le poids pesé, en kilos.',
  NoMethod: 'Choisis comment il a payé.',
  InvalidAmount: 'Ce qu’il a payé : en francs entiers, d’au moins 1 F.',
  SoldInFuture: 'La date ne peut pas être après aujourd’hui.',
  NotACustomer: 'Choisis un acheteur.',
  CounterpartyArchived: 'Cet acheteur n’est plus disponible.',
  NoLot: 'Choisis le lot.',
  StorageUnavailable: 'L’appareil n’arrive pas à garder cette vente. Réessaie, ou appelle le support.',
};
const SERVER_ERROR = 'La vente n’a pas pu être gardée. Réessaie.';
const BUYER_FACES: readonly CounterpartyFaceCode[] = ['hen', 'caretaker', 'truck', 'barn', 'paper'];

/**
 * Writing a sale (W.3), the same gesture as an expense: to whom → how many birds, at what price
 * (a head, or the kilo weighed) → paid all, part or nothing on the spot → the read-back said aloud
 * → Oui. The amount is the domain's, computed while typing; the sale is kept on the device first
 * and leaves when the network allows (P.7).
 */
@Component({
  selector: 'app-sale-gesture-page',
  imports: [FeeField, Banknotes, Pictogram, RouterLink, SpeakerButton],
  providers: [Sales],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="back" routerLink="../ventes" [queryParams]="{ lot: lotId() || null }">Annuler, revenir aux ventes</a>
    @if (lotName(); as name) {
      <p class="for">Pour : {{ name }}</p>
    }
    @switch (step()) {
      @case ('whom') {
        <h1>À qui as-tu vendu ? <app-speaker-button phrase="sale-to-whom" /></h1>
        <div class="tiles">
          @for (buyer of purchases.customers(); track buyer.id) {
            <button type="button" class="tile buyer" [class.chosen]="buyer.id === buyerId()" (click)="chooseBuyer(buyer.id)">
              <app-pictogram [picto]="face(buyer.face)" [decorative]="true" />
              <span>{{ buyer.name }}</span>
            </button>
          }
          <button type="button" class="tile new" (click)="creating.set(!creating())"><span class="plus" aria-hidden="true">+</span><span>Nouvel acheteur</span></button>
        </div>
        @if (creating()) {
          <div class="new-buyer">
            <label class="field"><span>Son nom</span><input name="buyerName" type="text" maxlength="60" [value]="newName()" (input)="newName.set(valueOf($event))" /></label>
            <div class="faces">
              @for (one of faces; track one) {
                <button type="button" class="face-choice" [class.chosen]="one === newFace()" (click)="newFace.set(one)"><app-pictogram [picto]="face(one)" [decorative]="true" /></button>
              }
            </div>
            <button type="button" class="yes add" [disabled]="busy()" (click)="createBuyer()"><app-pictogram picto="check" [decorative]="true" /> Ajouter cet acheteur</button>
          </div>
        }
      }
      @case ('howMany') {
        <h1>{{ buyerName() }} : combien de poulets ? <app-speaker-button phrase="sale-how-many" /></h1>
        <label class="field big"><span>Poulets vendus</span><input name="birds" type="number" inputmode="numeric" min="1" step="1" [value]="birds()" (input)="birds.set(valueOf($event))" /></label>
        <div class="choices" role="radiogroup" aria-label="Le prix">
          <label class="choice" [class.on]="byHead()"><input type="radio" name="pricing" [checked]="byHead()" (change)="byHead.set(true)" /> <app-pictogram picto="hen" [decorative]="true" /> Par poulet</label>
          <label class="choice" [class.on]="!byHead()"><input type="radio" name="pricing" [checked]="!byHead()" (change)="byHead.set(false)" /> <app-pictogram picto="scale" [decorative]="true" /> Au kilo</label>
        </div>
        @if (byHead()) {
          <label class="field big"><span>Prix d’un poulet</span><input name="unitPrice" type="number" inputmode="numeric" min="1" step="1" [value]="unitPrice()" (input)="unitPrice.set(valueOf($event))" /></label>
        } @else {
          <div class="pair">
            <label class="field big"><span>Poids pesé (kg)</span><input name="kilos" type="number" inputmode="decimal" min="0" step="0.1" [value]="kilos()" (input)="kilos.set(valueOf($event))" /></label>
            <label class="field big"><span>Prix du kilo</span><input name="pricePerKilo" type="number" inputmode="numeric" min="1" step="1" [value]="pricePerKilo()" (input)="pricePerKilo.set(valueOf($event))" /></label>
          </div>
        }
        <p class="amount" aria-live="polite">{{ amount() === null ? '—' : money(amount() ?? 0) }}</p>
        <app-banknotes [amount]="amount() ?? 0" />
        @if (problem(); as problem) {
          <p class="refusal" role="alert"><app-pictogram picto="cross" [decorative]="true" /> {{ problem }}</p>
        }
        <div class="actions">
          <button type="button" class="no" (click)="step.set('whom')"><app-pictogram picto="cross" [decorative]="true" /> Retour</button>
          <button type="button" class="yes next" (click)="toPaid()"><app-pictogram picto="check" [decorative]="true" /> Suivant</button>
        </div>
      }
      @case ('paid') {
        <h1>Il a payé combien, tout de suite ? <app-speaker-button phrase="sale-paid-how-much" /></h1>
        <div class="choices three" role="radiogroup" aria-label="Payé">
          <label class="choice" [class.on]="paid() === 'all'"><input type="radio" name="paid" [checked]="paid() === 'all'" (change)="paid.set('all')" /> Tout</label>
          <label class="choice" [class.on]="paid() === 'part'"><input type="radio" name="paid" [checked]="paid() === 'part'" (change)="paid.set('part')" /> Une partie</label>
          <label class="choice" [class.on]="paid() === 'none'"><input type="radio" name="paid" [checked]="paid() === 'none'" (change)="paid.set('none')" /> Rien, à crédit</label>
        </div>
        @if (paid() === 'part') {
          <label class="field big"><span>Reçu tout de suite</span><input name="received" type="number" inputmode="numeric" min="1" step="1" [value]="received()" (input)="received.set(valueOf($event))" /></label>
        }
        @if (paid() !== 'none') {
          <div class="methods" role="radiogroup" aria-label="Comment ?">
            @for (one of methods; track one.code) {
              <label class="method" [class]="'method method-' + one.tone">
                <input type="radio" name="method" [checked]="one.code === method()" (change)="method.set(one.code)" />
                <app-pictogram [picto]="one.picto" [decorative]="true" />
                <span>{{ one.words }}</span>
              </label>
            }
          </div>
          <app-fee-field [method]="method()" [available]="feeType() !== null" [(value)]="fee" />
        }
        @if (problem(); as problem) {
          <p class="refusal" role="alert"><app-pictogram picto="cross" [decorative]="true" /> {{ problem }}</p>
        }
        <div class="actions">
          <button type="button" class="no" (click)="step.set('howMany')"><app-pictogram picto="cross" [decorative]="true" /> Retour</button>
          <button type="button" class="yes next" (click)="toReadBack()"><app-pictogram picto="check" [decorative]="true" /> Suivant</button>
        </div>
      }
      @case ('readBack') {
        <section class="card" aria-label="Relecture">
          <p class="who"><app-pictogram [picto]="buyerFace()" [decorative]="true" /> <b>{{ buyerName() }}</b></p>
          <p class="birds"><app-pictogram picto="hen" [decorative]="true" /> {{ birdsCount() }} poulet{{ birdsCount() > 1 ? 's' : '' }}</p>
          <p class="amount">{{ money(amount() ?? 0) }}</p>
          <app-banknotes [amount]="amount() ?? 0" />
          <p class="how">{{ paidWords() }}</p>
          @if (feeWords(); as words) {
            <p class="fee-words">{{ words }}</p>
          }
          <app-speaker-button class="listen" [phrase]="readBack()" label="Écouter" />
        </section>
        <label class="field"><span>Vendu le</span><input name="soldOn" type="date" [value]="soldOn()" [max]="today()" (input)="soldOn.set(valueOf($event))" /></label>
        @if (problem(); as problem) {
          <p class="refusal" role="alert"><app-pictogram picto="cross" [decorative]="true" /> {{ problem }}</p>
        }
        <div class="actions">
          <button type="button" class="no" (click)="step.set('paid')"><app-pictogram picto="cross" [decorative]="true" /> Non</button>
          <button type="button" class="yes confirm" [disabled]="busy()" (click)="confirm()"><app-pictogram picto="check" [decorative]="true" /> Oui, c'est ça</button>
        </div>
      }
    }
  `,
  styles: `
    :host { display: block; padding-block-end: 24px; }
    .back { display: inline-flex; align-items: center; min-block-size: 44px; color: var(--color-ink); font-weight: 700; }
    .for { margin: 0 0 8px; color: var(--color-muted); font-weight: 700; }
    h1 { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 4px 0 12px; font: 700 1.3rem var(--font-hand); color: var(--color-earth); }
    .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 10px; }
    .tile {
      display: grid; justify-items: center; align-content: center; gap: 6px; min-block-size: 96px; padding: 8px 4px; cursor: pointer;
      background: var(--color-shell); border: 3px solid var(--color-card-edge); border-radius: var(--radius-wobble-1); box-shadow: var(--shadow-hard-sm);
      font: 700 0.95rem var(--font-hand); color: var(--color-earth); text-align: center;
    }
    .tile app-pictogram { inline-size: 44px; block-size: 44px; }
    .tile.chosen { border-color: var(--color-pasture); background: var(--color-pasture-light); }
    .tile.new { border-style: dashed; }
    .plus { font: 700 2rem var(--font-hand); }
    .new-buyer { display: grid; gap: 10px; margin-block-start: 12px; padding: 12px; background: var(--color-post-it); border-radius: var(--radius-wobble-3); }
    .faces { display: flex; flex-wrap: wrap; gap: 8px; }
    .face-choice { inline-size: 56px; block-size: 56px; border: 2px solid transparent; border-radius: var(--radius-blob); background: transparent; cursor: pointer; }
    .face-choice app-pictogram { inline-size: 40px; block-size: 40px; }
    .face-choice.chosen { border-color: var(--color-pasture); background: var(--color-pasture-light); }
    .field { display: grid; gap: 4px; margin-block-end: 10px; font-weight: 700; color: var(--color-earth); }
    .field input { min-block-size: 48px; padding: 0 12px; border: 2px solid var(--color-card-edge); border-radius: 4px; background: var(--color-paper); color: var(--color-ink); font: 1.1rem var(--font-reading); min-inline-size: 0; }
    .field.big input { font: 700 1.4rem var(--font-hand); text-align: end; font-variant-numeric: tabular-nums; }
    .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .choices { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-block-end: 12px; }
    .choices.three { grid-template-columns: 1fr 1fr 1fr; }
    .choice {
      position: relative; display: flex; align-items: center; justify-content: center; gap: 6px; min-block-size: 56px; padding: 0 6px; cursor: pointer; text-align: center;
      border: 3px solid var(--color-card-edge); border-radius: var(--radius-wobble-1); background: var(--color-paper); font: 700 1rem var(--font-hand); color: var(--color-earth);
    }
    .choice input { position: absolute; inset: 0; opacity: 0; margin: 0; cursor: pointer; }
    .choice app-pictogram { inline-size: 26px; block-size: 26px; }
    .choice.on { border-color: var(--color-pasture); background: var(--color-pasture-light); }
    .choice:has(input:focus-visible), .method:has(input:focus-visible) { outline: var(--focus-ring); outline-offset: 2px; }
    .amount { margin: 6px 0; text-align: center; font: 700 2.2rem var(--font-hand); color: var(--color-ink); font-variant-numeric: tabular-nums; }
    .methods { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-block-end: 10px; }
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
    .card { padding: 14px; margin-block-end: 12px; text-align: center; background: var(--color-shell); border: 2px solid var(--color-card-edge); border-radius: var(--radius-wobble-2); box-shadow: var(--shadow-hard-sm); }
    .card .who, .card .birds { display: flex; align-items: center; justify-content: center; gap: 8px; margin: 0 0 6px; font: 700 1.15rem var(--font-hand); color: var(--color-earth); }
    .card app-pictogram { inline-size: 36px; block-size: 36px; }
    .how { margin: 8px 0 0; font: 700 1.05rem var(--font-hand); color: var(--color-earth); }
    .listen { display: inline-block; margin-block-start: 8px; }
    .refusal { display: flex; align-items: center; gap: 8px; margin: 10px 0 0; padding: 10px 12px; border-inline-start: 5px solid var(--color-alert); background: var(--color-alert-light); color: var(--color-alert); font-weight: 700; }
    .refusal app-pictogram { inline-size: 24px; block-size: 24px; flex: none; }
    /* Always in sight, above the bar of five. */
    .actions {
      position: sticky; inset-block-end: var(--office-tabs-block-size, 0); z-index: 1; display: flex; gap: 12px;
      margin: 16px -16px 0; padding: 8px 16px; background: var(--color-paper); border-block-start: 2px dashed var(--color-card-edge);
    }
    .actions button, .add {
      min-block-size: 60px; display: flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer;
      border: 3px solid var(--color-ink); border-radius: var(--radius-wobble-1); box-shadow: var(--shadow-hard); font: 700 1.15rem var(--font-hand);
    }
    .actions app-pictogram, .add app-pictogram { inline-size: 26px; block-size: 26px; }
    .no { flex: 1; background: var(--color-neutral); color: var(--color-on-sign); }
    .yes { flex: 2; background: var(--color-pasture); color: var(--color-on-sign); }
    .yes:disabled { opacity: 0.6; cursor: wait; }
    button:focus-visible, a:focus-visible, input:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }
  `,
})
export class SaleGesturePage {
  protected readonly purchases = inject(Purchases);
  private readonly office = inject(Office);
  private readonly sales = inject(Sales);
  private readonly voice = inject(Voice);
  private readonly clock = inject(CLOCK);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly methods = METHODS;
  protected readonly faces = BUYER_FACES;
  protected readonly lotId = linkedSignal(() => this.route.snapshot.queryParamMap.get('lot') ?? this.office.lots()[0]?.campaignId ?? '');
  protected readonly lotName = computed(() => {
    const lot = this.office.lots().find((one) => one.campaignId === this.lotId());
    return lot === undefined ? null : `${lot.siteName} · Jour ${lot.campaignDay}`;
  });
  protected readonly today = computed(() => this.office.sites()[0]?.today ?? '');

  protected readonly step = signal<Step>('whom');
  protected readonly buyerId = signal('');
  protected readonly creating = signal(false);
  protected readonly newName = signal('');
  protected readonly newFace = signal<CounterpartyFaceCode>('hen');
  protected readonly birds = signal('');
  protected readonly byHead = signal(true);
  protected readonly unitPrice = signal('');
  protected readonly kilos = signal('');
  protected readonly pricePerKilo = signal('');
  /** Nothing is chosen for the admin: paid all, part or nothing is said. */
  protected readonly paid = signal<Paid>('all');
  protected readonly received = signal('');
  protected readonly method = signal<PaymentMethodCode | null>(null);
  protected readonly soldOn = linkedSignal(() => this.today());
  protected readonly busy = signal(false);
  protected readonly problem = signal<string | null>(null);
  /** Made once: kept on the device, the same sale leaves however many times it is tried. */
  private readonly saleId = crypto.randomUUID();
  private readonly receiptId = crypto.randomUUID();
  /** The Wave or Orange Money fee the farm paid on what was received now (P.8), and its expense's identifier. */
  protected readonly fee = signal('');
  private readonly feeId = crypto.randomUUID();
  protected readonly feeType = computed(() => feeTypeOf(this.purchases.activeCostTypes()));
  private readonly fees = inject(TransferFees);

  protected readonly buyer = computed(() => this.purchases.counterpartyById().get(this.buyerId()) ?? null);
  protected readonly buyerName = computed(() => this.buyer()?.name ?? '');
  protected readonly buyerFace = computed(() => (this.buyer()?.face ?? 'hen') as PictogramName);
  protected readonly birdsCount = computed(() => Number(this.birds()) || 0);
  private readonly pricing = computed((): RecordSaleRequest['pricing'] =>
    this.byHead() ? { kind: 'PerBird', unitPrice: numberOf(this.unitPrice()) } : { kind: 'PerKilo', grams: Math.round(numberOf(this.kilos()) * 1000), pricePerKilo: numberOf(this.pricePerKilo()) },
  );
  /** The domain's amount, while typing: never added up by the screen. */
  protected readonly amount = computed(() => {
    const currency = this.purchases.currency();
    if (currency === null) return null;
    const sale = recordSale(this.saleInput(), this.contextOf(currency));
    return sale.ok ? sale.value.amount.amount : null;
  });
  private readonly receivedAmount = computed(() => (this.paid() === 'all' ? (this.amount() ?? 0) : this.paid() === 'part' ? numberOf(this.received()) : 0));
  protected readonly paidWords = computed(() => {
    const due = (this.amount() ?? 0) - this.receivedAmount();
    if (this.paid() === 'none') return `à crédit : ${this.buyerName()} doit tout`;
    return due > 0 ? `payé ${this.money(this.receivedAmount())}, doit encore ${this.money(due)}` : 'tout est payé';
  });
  protected readonly readBack = computed((): PhrasePart[] => {
    const due = (this.amount() ?? 0) - this.receivedAmount();
    return [clip('sale-birds'), number(this.birdsCount()), clip('money-amount'), number(this.amount() ?? 0), clip('money-francs'), ...(due > 0 ? [clip('sale-still-owes'), number(due), clip('money-francs')] : [clip('sale-all-paid')]), clip('confirm')];
  });

  constructor() {
    void this.purchases.load();
    void this.voice.say([clip('sale-to-whom')]);
  }

  protected face(code: string): PictogramName {
    return code as PictogramName;
  }

  protected money(amount: number): string {
    return amountWords(amount, this.purchases.currency() ?? '');
  }

  protected valueOf(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected chooseBuyer(id: string): void {
    this.buyerId.set(id);
    this.problem.set(null);
    this.step.set('howMany');
    void this.voice.say([clip('sale-how-many')]);
  }

  protected async createBuyer(): Promise<void> {
    if (this.newName().trim() === '' || this.busy()) return;
    this.busy.set(true);
    const created = await this.purchases.createSupplier(this.newName(), this.newFace(), 'Customer');
    this.busy.set(false);
    if ('problem' in created) return this.problem.set(created.problem === 'NoNetwork' ? 'Créer un acheteur demande le réseau.' : SERVER_ERROR);
    this.creating.set(false);
    this.chooseBuyer(created.supplier.id);
  }

  protected toPaid(): void {
    const currency = this.purchases.currency();
    if (currency === null) return;
    const judged = recordSale(this.saleInput(), this.contextOf(currency));
    if (!judged.ok) return this.problem.set(WORDS[judged.error.kind] ?? SERVER_ERROR);
    this.problem.set(null);
    this.step.set('paid');
    void this.voice.say([clip('sale-paid-how-much')]);
  }

  /** The fee the farm paid, as an expense of the lot; none when nothing is received now. */
  private feeOf() {
    return feeCost({
      id: this.feeId,
      typed: this.paid() === 'none' ? '' : this.fee(),
      method: this.method(),
      campaignId: this.lotId() === '' ? null : this.lotId(),
      costTypeId: this.feeType(),
      on: this.soldOn(),
      about: `vente ${this.buyerName()}`,
    });
  }

  protected readonly feeWords = computed(() => {
    const fee = this.feeOf();
    const method = this.method();
    return fee.kind !== 'cost' || method === null ? null : `frais ${method === 'Wave' ? 'Wave' : 'Orange Money'} payés par toi : ${this.money(fee.request.amount)}`;
  });

  protected toReadBack(): void {
    const currency = this.purchases.currency();
    if (currency === null) return;
    if (this.paid() !== 'none') {
      if (this.method() === null) return this.problem.set(WORDS.NoMethod ?? SERVER_ERROR);
      const receipt = recordSaleReceipt({ id: this.receiptId, saleId: this.saleId, paidOn: this.soldOn(), amount: this.receivedAmount(), method: this.method() ?? 'Cash' }, this.contextOf(currency));
      if (!receipt.ok) return this.problem.set(WORDS[receipt.error.kind] ?? SERVER_ERROR);
      if (this.feeOf().kind === 'invalid') return this.problem.set(FEE_REFUSAL);
    }
    this.problem.set(null);
    this.step.set('readBack');
    void this.voice.say(this.readBack());
  }

  protected async confirm(): Promise<void> {
    const currency = this.purchases.currency();
    if (this.busy() || currency === null) return;
    if (this.lotId() === '') return this.problem.set(WORDS.NoLot ?? SERVER_ERROR);
    const request = this.request();
    const judged = recordSale(request, this.contextOf(currency));
    if (!judged.ok) return this.problem.set(WORDS[judged.error.kind] ?? SERVER_ERROR);
    const fee = this.feeOf();
    this.busy.set(true);
    const problem = await this.sales.record(request);
    // The fee after its sale: the buyer's payment keeps its whole amount, the fee is the lot's expense.
    const feeKept = problem === null && fee.kind === 'cost' && request.receivedNow !== null ? await this.fees.keep(fee.request) : true;
    this.busy.set(false);
    if (problem !== null) return this.problem.set(WORDS[problem] ?? SERVER_ERROR);
    if (!feeKept) return this.problem.set(WORDS.StorageUnavailable ?? SERVER_ERROR);
    void this.voice.say([clip('written-thanks')]);
    await this.router.navigate(['../ventes'], { relativeTo: this.route, queryParams: { lot: this.lotId() } });
  }

  /** The sale alone — what its amount is computed from. */
  private saleInput(): Omit<RecordSaleRequest, 'receivedNow'> {
    return { id: this.saleId, campaignId: this.lotId(), buyerId: this.buyerId(), soldOn: this.soldOn(), birds: numberOf(this.birds()), pricing: this.pricing() };
  }

  private request(): RecordSaleRequest {
    const received = this.receivedAmount();
    const method = this.method();
    return { ...this.saleInput(), receivedNow: this.paid() === 'none' || method === null || received <= 0 ? null : { id: this.receiptId, amount: received, method } };
  }

  private contextOf(currency: string): SaleContext {
    return {
      currency: currency as CurrencyCode,
      today: this.today() as BusinessDay,
      counterparties: [...this.purchases.counterpartyById().values()].map(({ id, kind, archived }) => ({ id, kind, archived })),
    };
  }
}

// An empty field is no figure at all: the domain then says which one is missing.
const numberOf = (typed: string): number => (typed.trim() === '' ? Number.NaN : Number(typed));
