import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { PictogramName } from '@design-system';
import type { PaymentMethodCode, RecordPaymentRequest } from '@contracts';
import { recordPayment } from '@domain/finance';
import type { CurrencyCode } from '@kit';
import { Pictogram } from '../../ui/pictogram';
import { FEE_REFUSAL, FeeField, feeCost, feeTypeOf, takesFee, TransferFees } from '../money/transfer-fee';
import { Office } from '../office';
import { amountWords, Purchases, type PurchaseProblem } from './purchases';

/** Each way of paying with its picture, its colour and its word. No brand mark: a phone for both mobile moneys. */
export const METHODS: readonly { readonly code: PaymentMethodCode; readonly picto: PictogramName; readonly tone: string; readonly words: string }[] = [
  { code: 'Cash', picto: 'coin', tone: 'cash', words: 'Espèces' },
  { code: 'Wave', picto: 'mobile-money', tone: 'wave', words: 'Wave' },
  { code: 'OrangeMoney', picto: 'mobile-money', tone: 'orange', words: 'Orange Money' },
];
const METHOD_WORDS: Record<PaymentMethodCode, string> = { Cash: 'Espèces', Wave: 'Wave', OrangeMoney: 'Orange Money' };

const WORDS: Partial<Record<PurchaseProblem | 'NoMethod', string>> = {
  NoMethod: 'Choisis comment tu as payé.',
  InvalidAmount: 'Un montant en francs entiers, d’au moins 1 F.',
  InvalidBusinessDay: 'La date n’est pas une date.',
  UnknownPaymentMethod: 'Choisis comment tu as payé.',
  OrderNotFound: 'Cette commande n’existe plus.',
  NoNetwork: 'Pas de réseau : rien n’est payé. Réessaie avec le réseau.',
  StorageUnavailable: 'L’appareil n’arrive pas à garder ce paiement. Réessaie, ou appelle le support.',
};
const SERVER_ERROR = 'Le serveur n’a pas pu enregistrer le paiement. Réessaie.';

/**
 * Paying an order (Q.9), online: how much, on which day, how. What is left to pay is offered; the
 * payment is judged by the domain before it leaves, and by the server, which decides. Its
 * identifier is made here once: tried again after a failure, it is the same payment.
 */
@Component({
  selector: 'app-payment-page',
  imports: [FeeField, Pictogram, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1><app-pictogram picto="coin" [decorative]="true" /> Payer {{ supplier() }}</h1>
    <a class="back" routerLink="../..">Annuler, revenir aux achats</a>
    @if (order(); as order) {
      <section class="balance" aria-label="Où en est l’argent">
        @if (order.billable === 0) {
          <p class="advance"><app-pictogram picto="truck" [decorative]="true" /> Rien de reçu encore : ce paiement est une avance.</p>
        } @else {
          <p><span>À payer</span>&ngsp;<strong>{{ money(order.billable) }}</strong></p>
        }
        <p><span>Déjà payé</span>&ngsp;<strong>{{ money(order.paid) }}</strong></p>
        @if (left() > 0) {
          <p class="left"><span>Reste à payer</span>&ngsp;<strong>{{ money(left()) }}</strong></p>
        } @else if (left() < 0) {
          <p class="owed"><span>{{ supplier() }} te doit</span>&ngsp;<strong>{{ money(-left()) }}</strong></p>
        }
      </section>
      @if (order.payments.length > 0) {
        <ul class="paid-list" aria-label="Paiements déjà faits">
          @for (payment of order.payments; track payment.id) {
            <li><span>{{ dayWords(payment.paidOn) }}</span>&ngsp;<span>{{ methodWords[payment.method] }}{{ payment.paidBy === null ? '' : ', payé par ' + nameOf(payment.paidBy) }}</span>&ngsp;<strong>{{ money(payment.amount) }}</strong></li>
          }
        </ul>
      }

      <!-- novalidate: the domain judges, and says why in words. -->
      <form novalidate (submit)="$event.preventDefault(); pay()">
        <div class="when">
          <label class="field">
            <span>Combien ?</span>
            <input name="amount" type="number" inputmode="numeric" min="1" step="1" [value]="amount()" (input)="amount.set(valueOf($event))" />
          </label>
          <label class="field">
            <span>Payé le</span>
            <input name="paidOn" type="date" [value]="paidOn()" (input)="paidOn.set(valueOf($event))" />
          </label>
        </div>

        <fieldset>
          <legend>Comment ?</legend>
          <div class="methods">
            @for (one of methods; track one.code) {
              <label class="method" [class]="'method method-' + one.tone">
                <input type="radio" name="method" [value]="one.code" [checked]="one.code === method()" (change)="method.set(one.code)" />
                <app-pictogram [picto]="one.picto" [decorative]="true" />
                <span>{{ one.words }}</span>
              </label>
            }
          </div>
        </fieldset>
        <!-- Paid by someone else (R.4): rare, so behind « Plus de détails ». -->
        <details class="payer-more" [open]="payerId() !== ''">
          <summary>Plus de détails : payé par quelqu’un d’autre</summary>
          <div class="payers">
            @for (one of payers(); track one.id) {
              <button type="button" class="payer" [class.chosen]="one.id === payerId()" (click)="payerId.set(one.id === payerId() ? '' : one.id)">
                <app-pictogram [picto]="faceOf(one.face)" [decorative]="true" />
                <span>{{ one.name }}</span>
              </button>
            }
          </div>
        </details>
        <app-fee-field [method]="method()" [payer]="mobileMoney() ? payerName() : null" [available]="feeType() !== null" [(value)]="fee" />

        @if (problem(); as problem) {
          <p class="refusal" role="alert"><app-pictogram picto="cross" [decorative]="true" /> {{ problem }}</p>
        }
        <div class="actions">
          <button type="submit" class="go" [disabled]="busy()"><app-pictogram picto="check" [decorative]="true" /> Payer</button>
        </div>
      </form>
    } @else if (purchases.loaded()) {
      <p class="refusal" role="alert"><app-pictogram picto="cross" [decorative]="true" /> {{ purchases.unreachable() ? 'Pas de réseau : la commande ne se lit pas.' : 'Cette commande n’existe pas.' }}</p>
    }
  `,
  styles: `
    :host { display: block; }
    h1 { display: flex; align-items: center; gap: 8px; margin: 0 0 4px; font: 700 1.35rem var(--font-hand); color: var(--color-earth); }
    h1 app-pictogram { inline-size: 36px; block-size: 36px; }
    .back { display: inline-flex; align-items: center; min-block-size: 44px; margin-block-end: 8px; color: var(--color-ink); font-weight: 700; }
    .balance {
      display: grid; gap: 6px; margin-block-end: 14px; padding: 12px 14px;
      background: var(--color-shell); border: 2px solid var(--color-card-edge); border-radius: var(--radius-wobble-2); box-shadow: var(--shadow-hard-sm);
    }
    .balance p { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin: 0; color: var(--color-earth); font-weight: 700; }
    .balance strong { font: 700 1.2rem var(--font-hand); color: var(--color-ink); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .balance .left { padding-block-start: 6px; border-block-start: 2px dashed var(--color-card-edge); }
    .balance .left strong { font-size: 1.45rem; color: var(--color-alert); }
    .balance .owed strong { color: var(--color-pasture); }
    .balance .advance { justify-content: flex-start; gap: 8px; font-weight: 400; font-style: italic; }
    .balance .advance app-pictogram { inline-size: 26px; block-size: 26px; flex: none; }
    .paid-list { list-style: none; margin: 0 0 16px; padding: 0; display: grid; gap: 4px; }
    .paid-list li { display: grid; grid-template-columns: auto 1fr auto; gap: 10px; padding: 6px 4px; border-block-end: 1px solid var(--color-rule); color: var(--color-earth); }
    .paid-list strong { font-variant-numeric: tabular-nums; }
    form { display: grid; gap: 18px; padding-block-end: 88px; }
    fieldset { margin: 0; padding: 0; border: 0; min-inline-size: 0; }
    legend { margin-block-end: 8px; padding: 0; font: 700 1.05rem var(--font-hand); color: var(--color-earth); }
    .when { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
    .field { display: grid; gap: 4px; font-weight: 700; color: var(--color-earth); }
    .field input {
      min-block-size: 48px; padding: 0 12px; border: 2px solid var(--color-card-edge); border-radius: 4px; min-inline-size: 0;
      background: var(--color-paper); color: var(--color-ink); font: 1.1rem var(--font-reading);
    }
    .field input[name='amount'] { font: 700 1.3rem var(--font-hand); text-align: end; font-variant-numeric: tabular-nums; }
    .methods { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .method {
      position: relative; display: grid; justify-items: center; align-content: center; gap: 4px; min-block-size: 92px; padding: 8px 4px; cursor: pointer;
      background: var(--color-shell); border: 3px solid var(--color-card-edge); border-block-end-width: 6px; border-radius: var(--radius-wobble-1);
      box-shadow: var(--shadow-hard-sm); color: var(--color-earth); font: 700 0.95rem var(--font-hand); text-align: center;
    }
    .method:nth-child(even) { border-radius: var(--radius-wobble-2); }
    .method input { position: absolute; inset: 0; margin: 0; opacity: 0; cursor: pointer; }
    .method app-pictogram { inline-size: 40px; block-size: 40px; }
    .method-cash { border-block-end-color: var(--color-corn); }
    .method-wave { border-block-end-color: var(--color-blue); }
    .method-orange { border-block-end-color: var(--color-orange); }
    .method:has(input:checked) { border-color: var(--color-pasture); background: var(--color-pasture-light); box-shadow: var(--shadow-hard); }
    .method:has(input:checked)::after {
      content: '✓'; position: absolute; inset-block-start: -10px; inset-inline-end: -8px; display: grid; place-items: center;
      inline-size: 26px; block-size: 26px; border-radius: var(--radius-blob); background: var(--color-pasture); color: var(--color-on-sign); font-weight: 700;
    }
    .method:has(input:focus-visible) { outline: 4px solid var(--color-blue); outline-offset: 2px; }
    input:focus-visible, button:focus-visible, a:focus-visible { outline: 4px solid var(--color-blue); outline-offset: 2px; }
    .payer-more { padding: 8px 12px; border: 2px dashed var(--color-card-edge); border-radius: 4px; }
    .payer-more summary { min-block-size: 44px; display: flex; align-items: center; cursor: pointer; font-weight: 700; color: var(--color-earth); }
    .payers { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 10px; margin-block: 8px; }
    .payer {
      display: grid; justify-items: center; gap: 4px; min-block-size: 88px; padding: 8px 4px; cursor: pointer; background: var(--color-shell);
      border: 3px solid var(--color-card-edge); border-radius: var(--radius-wobble-1); box-shadow: var(--shadow-hard-sm); color: var(--color-earth); font: 700 0.95rem var(--font-hand);
    }
    .payer app-pictogram { inline-size: 40px; block-size: 40px; }
    .payer.chosen { border-color: var(--color-pasture); background: var(--color-pasture-light); }
    .refusal { display: flex; align-items: center; gap: 8px; margin: 0; padding: 10px 12px; border-inline-start: 5px solid var(--color-alert); background: var(--color-alert-light); color: var(--color-alert); font-weight: 700; }
    .refusal app-pictogram { inline-size: 24px; block-size: 24px; flex: none; }
    /* Always in sight, above the bar of five: the one action of the page. */
    .actions {
      position: fixed; inset-inline: 0; inset-block-end: var(--office-tabs-block-size, 0); z-index: 1; display: flex; justify-content: flex-end;
      padding: 8px 16px; background: var(--color-paper); border-block-start: 2px dashed var(--color-card-edge);
    }
    .go {
      display: inline-flex; align-items: center; gap: 8px; min-block-size: 52px; padding: 0 22px;
      border: 3px solid var(--color-ink); border-radius: var(--radius-wobble-1); box-shadow: var(--shadow-hard);
      background: var(--color-pasture); color: var(--color-on-sign); font: 700 1.15rem var(--font-hand);
    }
    .go app-pictogram { inline-size: 24px; block-size: 24px; }
    .go:disabled { opacity: 0.6; }
  `,
})
export class PaymentPage {
  protected readonly purchases = inject(Purchases);
  private readonly office = inject(Office);
  private readonly router = inject(Router);
  // The office lives under a prefix (/admin): every link is relative to this page's route.
  private readonly route = inject(ActivatedRoute);

  protected readonly methods = METHODS;
  protected readonly methodWords = METHOD_WORDS;
  private readonly orderId = this.route.snapshot.paramMap.get('id') ?? '';
  protected readonly order = computed(() => this.purchases.orders().find((order) => order.id === this.orderId) ?? null);
  protected readonly supplier = computed(() => this.purchases.counterpartyById().get(this.order()?.supplierId ?? '')?.name ?? 'le fournisseur');
  /** Billable − paid: above zero, left to pay; below zero, the supplier owes the farm. */
  protected readonly left = computed(() => (this.order()?.billable ?? 0) - (this.order()?.paid ?? 0));

  /** What is left to pay is offered; nothing when nothing is left. */
  protected readonly amount = linkedSignal(() => (this.left() > 0 ? String(this.left()) : ''));
  protected readonly paidOn = linkedSignal(() => this.office.sites()[0]?.today ?? '');
  /** Never chosen for the admin. */
  protected readonly method = signal<PaymentMethodCode | null>(null);
  protected readonly busy = signal(false);
  protected readonly problem = signal<string | null>(null);
  /** Made once: a payment tried again after a failure keeps its identifier, so the server keeps it once. */
  private readonly paymentId = crypto.randomUUID();
  /** The Wave or Orange Money fee the farm paid (P.8), typed; and its expense's identifier, made once too. */
  protected readonly fee = signal('');
  private readonly feeId = crypto.randomUUID();
  protected readonly feeType = computed(() => feeTypeOf(this.purchases.activeCostTypes()));
  /** Someone else who paid the order for the farm (R.4): any counterparty in use but its supplier. */
  protected readonly payerId = signal('');
  protected readonly payers = computed(() => [...this.purchases.counterpartyById().values()].filter((one) => !one.archived && one.id !== this.order()?.supplierId));
  protected readonly mobileMoney = computed(() => takesFee(this.method()));
  protected readonly payerName = computed(() => (this.payerId() === '' ? null : this.nameOf(this.payerId())));
  private readonly fees = inject(TransferFees);

  constructor() {
    void this.purchases.load();
  }

  protected money(amount: number): string {
    return amountWords(amount, this.order()?.currency ?? this.purchases.currency() ?? '');
  }

  protected nameOf(counterpartyId: string): string {
    return this.purchases.counterpartyById().get(counterpartyId)?.name ?? 'un tiers';
  }

  protected faceOf(face: string): PictogramName {
    return face as PictogramName;
  }

  protected dayWords(day: string): string {
    const [year, month, date] = day.split('-');
    return `${date}/${month}/${year}`;
  }

  protected valueOf(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected async pay(): Promise<void> {
    const order = this.order();
    if (this.busy() || order === null) return;
    const method = this.method();
    if (method === null) return this.problem.set(WORDS.NoMethod ?? SERVER_ERROR);
    const payer = this.payerId();
    const request: RecordPaymentRequest = { id: this.paymentId, paidOn: this.paidOn(), amount: numberOf(this.amount()), method, ...(payer === '' ? {} : { paidBy: payer }) };
    // The same rule as the server's, so that a refusal is said before anything leaves.
    const judged = recordPayment({ ...request, orderId: order.id }, order.currency as CurrencyCode);
    if (!judged.ok) return this.problem.set(WORDS[judged.error.kind === 'InvalidId' ? 'ServerError' : judged.error.kind] ?? SERVER_ERROR);
    const fee = feeCost({
      id: this.feeId,
      typed: this.fee(),
      method,
      campaignId: order.campaignId,
      costTypeId: this.feeType(),
      on: request.paidOn,
      about: payer === '' ? `paiement ${this.supplier()}` : `paiement ${this.supplier()} payé par ${this.payerName() ?? ''}`,
      ...(payer === '' || !takesFee(method) ? {} : { paidBy: payer }),
    });
    if (fee.kind === 'invalid') return this.problem.set(FEE_REFUSAL);
    this.busy.set(true);
    this.problem.set(null);
    const problem = await this.purchases.pay(order.id, request);
    // The fee after its payment: the payment keeps its whole amount, the fee is the farm's expense.
    const feeKept = problem === null && fee.kind === 'cost' ? await this.fees.keep(fee.request) : true;
    this.busy.set(false);
    if (problem !== null) return this.problem.set(WORDS[problem] ?? SERVER_ERROR);
    if (!feeKept) return this.problem.set(WORDS.StorageUnavailable ?? SERVER_ERROR);
    await this.router.navigate(['../..'], { relativeTo: this.route });
  }
}

// An empty field is no figure at all: the domain then says the amount is missing.
const numberOf = (typed: string): number => (typed.trim() === '' ? Number.NaN : Number(typed));
