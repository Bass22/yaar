import { ChangeDetectionStrategy, Component, computed, effect, inject, linkedSignal, signal, untracked } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { PaymentMethodCode } from '@contracts';
import { recordSaleReceipt } from '@domain/finance';
import type { BusinessDay } from '@domain/journal';
import type { CurrencyCode } from '@kit';
import { Pictogram } from '../../ui/pictogram';
import { FiguresAge } from '../figures-age';
import { Office } from '../office';
import { OfficePending } from '../office-pending';
import { OfficeSync } from '../office-sync';
import { FEE_REFUSAL, FeeField, feeCost, feeTypeOf, TransferFees } from '../money/transfer-fee';
import { METHODS } from '../purchases/payment-page';
import { amountWords, Purchases } from '../purchases/purchases';
import { Sales } from './sales';
import { currencyWord, dayWords, grouped, typedNumber, typedText } from '../typed-number';
import { Affixed } from '../../ui/affixed';

const METHOD_WORDS: Record<PaymentMethodCode, string> = { Cash: 'Espèces', Wave: 'Wave', OrangeMoney: 'Orange Money' };

// One sale (W.3): what it came to, what was received and when, what is still owed; « Encaisser »
// offers what is owed, today's date, the way of paying never chosen ahead. Kept on the device
// first (P.7); the server sums.
@Component({
  selector: 'app-sale-page',
  imports: [Affixed, FeeField, FiguresAge, OfficePending, Pictogram, RouterLink],
  providers: [Sales],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="back" routerLink=".." [queryParams]="{ lot: lotId() }">Revenir aux ventes</a>
    @if (sale(); as sale) {
      <h1><app-pictogram picto="hen" [decorative]="true" /> {{ buyer() }} · {{ sale.birds }} poulets</h1>
      <app-figures-age [readAt]="sales.readAt()" [stale]="sales.unreachable()" />
      <app-office-pending [kinds]="['saleReceipt']" [subject]="lotId()" />
      <section class="balance" [class.owed]="due() > 0" aria-label="Où en est la vente">
        <p><span>Vente</span>&ngsp;<strong>{{ money(sale.amount) }}</strong></p>
        <p><span>Reçu</span>&ngsp;<strong>{{ money(sale.received) }}</strong></p>
        <p class="due">
          <span>{{ due() > 0 ? 'Il doit encore' : due() < 0 ? 'Tu lui dois' : 'Tout est payé' }}</span>&ngsp;
          @if (due() !== 0) {
            <strong>{{ money(abs(due())) }}</strong>
          }
        </p>
      </section>
      <ul class="receipts" aria-label="Encaissements">
        @for (receipt of sale.receipts; track receipt.id) {
          <li><span>{{ day(receipt.paidOn) }}</span>&ngsp;<span>{{ methodWords[receipt.method] }}</span>&ngsp;<strong>{{ money(receipt.amount) }}</strong></li>
        }
      </ul>
      <section class="receive" aria-label="Encaisser">
        <h2>Encaisser</h2>
        <div class="when">
          <label class="field"><span>Combien ?</span><app-affixed [unit]="currencyWord(purchases.currency())"><input name="amount" type="text" inputmode="numeric" autocomplete="off" [value]="grouped(amount())" (input)="amount.set(typedNumber($event))" /></app-affixed></label>
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
        <app-fee-field [method]="method()" [available]="feeType() !== null" [(value)]="fee" />
        @if (problem(); as problem) {
          <p class="refusal" role="alert"><app-pictogram picto="cross" [decorative]="true" /> {{ problem }}</p>
        }
        <button type="button" class="go" [disabled]="busy()" (click)="receive()"><app-pictogram picto="check" [decorative]="true" /> Encaisser</button>
      </section>
    } @else if (sales.view() !== null) {
      <p class="none">Cette vente n’est pas (encore) au serveur.</p>
    }
  `,
  styles: `
    :host { display: block; padding-block-end: 16px; }
    .back { display: inline-flex; align-items: center; min-block-size: 44px; color: var(--color-ink); font-weight: 700; }
    h1 { display: flex; align-items: center; gap: 8px; margin: 4px 0 8px; font: 700 1.3rem var(--font-hand); color: var(--color-earth); }
    h1 app-pictogram { inline-size: 36px; block-size: 36px; }
    .balance { display: grid; gap: 6px; padding: 12px 14px; background: var(--color-shell); border: 2px solid var(--color-card-edge); border-inline-start: 6px solid var(--color-pasture); border-radius: var(--radius-wobble-2); box-shadow: var(--shadow-hard-sm); }
    .balance.owed { border-inline-start-color: var(--color-orange); }
    .balance p { display: flex; justify-content: space-between; margin: 0; font-weight: 700; color: var(--color-earth); }
    .balance strong { font: 700 1.2rem var(--font-hand); color: var(--color-ink); font-variant-numeric: tabular-nums; }
    .balance .due { padding-block-start: 6px; border-block-start: 2px dashed var(--color-card-edge); }
    .receipts { list-style: none; margin: 12px 0; padding: 0; }
    .receipts li { display: grid; grid-template-columns: auto 1fr auto; gap: 10px; padding: 6px 2px; border-block-end: 1px solid var(--color-rule); color: var(--color-earth); }
    .receive { display: grid; gap: 12px; padding: 12px; border: 2px dashed var(--color-card-edge); border-radius: 4px; }
    h2 { margin: 0; font: 700 1.15rem var(--font-hand); color: var(--color-earth); }
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
    .method:has(input:focus-visible) { outline: var(--focus-ring); outline-offset: 2px; }
    .refusal { display: flex; align-items: center; gap: 8px; margin: 0; padding: 10px 12px; border-inline-start: 5px solid var(--color-alert); background: var(--color-alert-light); color: var(--color-alert); font-weight: 700; }
    .refusal app-pictogram { inline-size: 24px; block-size: 24px; flex: none; }
    .go { display: flex; align-items: center; justify-content: center; gap: 8px; min-block-size: 56px; cursor: pointer; border: 3px solid var(--color-ink); border-radius: var(--radius-wobble-1); box-shadow: var(--shadow-hard); background: var(--color-pasture); color: var(--color-on-sign); font: 700 1.15rem var(--font-hand); }
    .go app-pictogram { inline-size: 24px; block-size: 24px; }
    .go:disabled { opacity: 0.6; }
    .none { color: var(--color-muted); font-style: italic; }
    a:focus-visible, button:focus-visible, input:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }
  `,
})
export class SalePage {
  protected readonly grouped = grouped;
  protected readonly typedNumber = typedNumber;
  protected readonly currencyWord = currencyWord;
  protected readonly sales = inject(Sales);
  protected readonly purchases = inject(Purchases);
  private readonly office = inject(Office);
  private readonly officeSync = inject(OfficeSync);
  private readonly route = inject(ActivatedRoute);

  protected readonly methods = METHODS;
  protected readonly methodWords = METHOD_WORDS;
  protected readonly abs = Math.abs;
  private readonly saleId = this.route.snapshot.paramMap.get('id') ?? '';
  protected readonly lotId = linkedSignal(() => this.route.snapshot.queryParamMap.get('lot') ?? this.office.currentLot()?.campaignId ?? '');
  protected readonly sale = computed(() => this.sales.view()?.sales.find((one) => one.id === this.saleId) ?? null);
  protected readonly due = computed(() => (this.sale()?.amount ?? 0) - (this.sale()?.received ?? 0));
  protected readonly buyer = computed(() => this.purchases.counterpartyById().get(this.sale()?.buyerId ?? '')?.name ?? 'Acheteur');
  protected readonly today = computed(() => this.office.today());
  /** What is owed is offered. */
  protected readonly amount = linkedSignal(() => (this.due() > 0 ? String(this.due()) : ''));
  protected readonly paidOn = linkedSignal(() => this.today());
  protected readonly method = signal<PaymentMethodCode | null>(null);
  protected readonly busy = signal(false);
  protected readonly problem = signal<string | null>(null);
  private receiptId = crypto.randomUUID();
  /** The Wave or Orange Money fee the farm paid on this receipt (P.8), and its expense's identifier. */
  protected readonly fee = signal('');
  private feeId = crypto.randomUUID();
  protected readonly feeType = computed(() => feeTypeOf(this.purchases.activeCostTypes()));
  private readonly fees = inject(TransferFees);

  constructor() {
    void this.purchases.load();
    effect(() => {
      const lot = this.lotId();
      this.officeSync.revision();
      if (lot !== '') untracked(() => void this.sales.load(lot));
    });
  }

  protected money(amount: number): string {
    return amountWords(amount, this.sales.view()?.currency ?? this.purchases.currency() ?? '');
  }

  protected day(on: string): string {
    return dayWords(on);
  }

  protected valueOf(event: Event): string {
    return typedText(event);
  }

  protected async receive(): Promise<void> {
    const currency = this.purchases.currency();
    const method = this.method();
    if (this.busy() || currency === null) return;
    if (method === null) return this.problem.set('Choisis comment il a payé.');
    const request = { id: this.receiptId, paidOn: this.paidOn(), amount: this.amount().trim() === '' ? Number.NaN : Number(this.amount()), method };
    const judged = recordSaleReceipt({ ...request, saleId: this.saleId }, { currency: currency as CurrencyCode, today: this.today() as BusinessDay });
    if (!judged.ok) return this.problem.set(judged.error.kind === 'PaidInFuture' ? 'La date ne peut pas être après aujourd’hui.' : 'Un montant en francs entiers, d’au moins 1 FCFA.');
    const fee = feeCost({ id: this.feeId, typed: this.fee(), method, campaignId: this.lotId() === '' ? null : this.lotId(), costTypeId: this.feeType(), on: request.paidOn, about: `encaissement ${this.buyer()}` });
    if (fee.kind === 'invalid') return this.problem.set(FEE_REFUSAL);
    this.busy.set(true);
    this.problem.set(null);
    const problem = await this.sales.receive(this.saleId, this.lotId(), request);
    // The fee after its receipt: what the buyer paid lowers all its debt; the fee is the lot's expense.
    const feeKept = problem === null && fee.kind === 'cost' ? await this.fees.keep(fee.request) : true;
    this.busy.set(false);
    if (problem !== null || !feeKept) return this.problem.set('L’appareil n’arrive pas à garder cet encaissement. Réessaie.');
    this.receiptId = crypto.randomUUID();
    this.feeId = crypto.randomUUID();
    this.fee.set('');
    this.method.set(null);
  }
}
