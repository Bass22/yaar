import { ChangeDetectionStrategy, Component, Injectable, computed, inject, input, model } from '@angular/core';
import type { CostTypeView, PaymentMethodCode, RecordCostRequest } from '@contracts';
import { CLOCK } from '../../core/clock';
import { OfficeSync } from '../office-sync';

const MOBILE_MONEY: Partial<Record<PaymentMethodCode, string>> = { Wave: 'Wave', OrangeMoney: 'Orange Money' };

/** Only a transfer by Wave or Orange Money costs a fee (P.8); cash never does. */
export const takesFee = (method: PaymentMethodCode | null): boolean => method !== null && MOBILE_MONEY[method] !== undefined;

/** The farm's type of the « Frais financiers » category, still in use: what a fee is written as; `null` without one. */
export const feeTypeOf = (types: readonly CostTypeView[]): string | null => types.find((type) => type.category === 'FinancialCharges' && !type.archived)?.id ?? null;

export type TransferFee = { readonly kind: 'none' } | { readonly kind: 'invalid' } | { readonly kind: 'cost'; readonly request: RecordCostRequest };

/**
 * The fee the farm paid for a transfer (P.8; CdC « Les frais Wave et Orange Money »): typed as read,
 * never computed. Empty or zero: no fee. Otherwise a paid expense of the flock, of the farm's
 * « Frais financiers » type, on the day of the transfer, saying where it comes from. It never
 * changes what the counterparty owes: the payment keeps its whole amount.
 */
export function feeCost(fee: {
  readonly id: string;
  readonly typed: string;
  readonly method: PaymentMethodCode | null;
  readonly campaignId: string | null;
  readonly costTypeId: string | null;
  readonly on: string;
  /** What the transfer was: « paiement Sedima », « vente Moussa ». */
  readonly about: string;
  /**
   * Someone else who paid for the farm (R.4), and whose fees the farm takes on: the fee is then
   * « paid by » it, taken off what it owes — whatever the way, since an expense has none.
   */
  readonly paidBy?: string;
}): TransferFee {
  const typed = fee.typed.trim();
  const applies = takesFee(fee.method) || fee.paidBy !== undefined;
  if (!applies || fee.campaignId === null || fee.costTypeId === null || typed === '' || /^0+$/.test(typed)) return { kind: 'none' };
  if (!/^\d+$/.test(typed) || !Number.isSafeInteger(Number(typed))) return { kind: 'invalid' };
  return {
    kind: 'cost',
    request: {
      id: fee.id,
      campaignId: fee.campaignId,
      costTypeId: fee.costTypeId,
      spentOn: fee.on,
      amount: Number(typed),
      note: `Frais ${(fee.method === null ? undefined : MOBILE_MONEY[fee.method]) ?? 'de transfert'} — ${fee.about}`,
      payment: fee.paidBy === undefined ? { kind: 'Paid' } : { kind: 'PaidBy', counterpartyId: fee.paidBy },
      receipt: null,
    },
  };
}

/** Keeps a fee on the device, like any expense, after the transfer it comes from (P.7, P.8). */
@Injectable({ providedIn: 'root' })
export class TransferFees {
  private readonly office = inject(OfficeSync);
  private readonly clock = inject(CLOCK);

  /** `true` once kept; `false` when the device cannot keep it. */
  keep(request: RecordCostRequest): Promise<boolean> {
    return this.office.keep('cost', '/api/v1/costs', { ...request, recordedAt: this.clock.now().toISOString() }, request.campaignId);
  }
}

export const FEE_REFUSAL = 'Les frais : des francs entiers, ou rien si c’est l’autre qui les paie.';

// The « Frais » box (P.8): shown once Wave or Orange Money is chosen, and only where a fee can be
// written; empty when the other side pays the fee.
@Component({
  selector: 'app-fee-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (shown()) {
      <label class="fee">
        @if (payer(); as payer) {
          <span>Frais {{ methodWords() || 'de transfert' }} payés par {{ payer }}, à ta charge</span>
        } @else {
          <span>Frais {{ methodWords() }} payés par toi</span>
        }
        <input name="fee" type="number" inputmode="numeric" min="0" step="1" [value]="value()" (input)="value.set(valueOf($event))" />
        <small>{{ payer() === null ? 'Laisse vide si c’est l’autre qui paie les frais.' : 'Ils se déduisent de ce qu’il doit. Laisse vide s’ils restent à sa charge.' }}</small>
      </label>
    }
  `,
  styles: `
    :host { display: block; }
    .fee { display: grid; gap: 4px; font-weight: 700; color: var(--color-earth); }
    .fee input {
      min-block-size: 48px; padding: 0 12px; border: 2px solid var(--color-card-edge); border-radius: 4px; min-inline-size: 0;
      background: var(--color-paper); color: var(--color-ink); font: 700 1.2rem var(--font-hand); text-align: end; font-variant-numeric: tabular-nums;
    }
    .fee input:focus-visible { outline: 4px solid var(--color-blue); outline-offset: 2px; }
    .fee small { font-weight: 400; color: var(--color-muted); }
  `,
})
export class FeeField {
  readonly method = input<PaymentMethodCode | null>(null);
  /** False where no fee can be written: no « Frais financiers » type, or no flock to carry it. */
  readonly available = input(true);
  /** The name of someone else who paid for the farm (R.4): its fees, taken on, whatever the way. */
  readonly payer = input<string | null>(null);
  readonly value = model('');

  protected readonly shown = computed(() => this.available() && (takesFee(this.method()) || this.payer() !== null));
  protected readonly methodWords = computed(() => {
    const method = this.method();
    return method === null ? '' : (MOBILE_MONEY[method] ?? '');
  });

  protected valueOf(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
}
