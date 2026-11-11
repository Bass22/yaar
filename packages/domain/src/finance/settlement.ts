import { err, Money, ok, type Brand, type CurrencyCode, type Result } from '@kit';
import { BusinessDay } from '../journal/business-day';
import { PAYMENT_METHODS, type PaymentMethod } from './order-balance';
import type { CounterpartyId } from './purchase-order';

export type SettlementId = Brand<string, 'SettlementId'>;

/** Money given to the counterparty, or received from it (R.2). */
export const SETTLEMENT_DIRECTIONS = Object.freeze(['ToCounterparty', 'FromCounterparty'] as const);
export type SettlementDirection = (typeof SETTLEMENT_DIRECTIONS)[number];

/** A settlement with a counterparty, outside an order: a money entry, written once and never changed. */
export type Settlement = {
  readonly id: SettlementId;
  readonly counterpartyId: CounterpartyId;
  readonly paidOn: BusinessDay;
  readonly amount: Money;
  readonly method: PaymentMethod;
  readonly direction: SettlementDirection;
};

export type SettlementInput = {
  readonly id: string;
  readonly counterpartyId: string;
  readonly paidOn: string;
  /** Whole units of the farm's currency, at least 1. */
  readonly amount: number;
  readonly method: PaymentMethod;
  readonly direction: SettlementDirection;
};

export type SettlementContext = {
  readonly currency: CurrencyCode;
  readonly today: BusinessDay;
  readonly counterparties: readonly { readonly id: string; readonly archived: boolean }[];
};

export type SettlementRefusal =
  | { readonly kind: 'InvalidId'; readonly expected: 'SettlementId' }
  | { readonly kind: 'InvalidBusinessDay' }
  | { readonly kind: 'PaidInFuture' }
  | { readonly kind: 'InvalidAmount' }
  | { readonly kind: 'UnknownPaymentMethod' }
  | { readonly kind: 'UnknownDirection' }
  | { readonly kind: 'UnknownCounterparty' }
  | { readonly kind: 'CounterpartyArchived' };

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * A settlement (R.2): a date never ahead of today, an amount of at least one unit, a method, a
 * direction, a counterparty still in use. A settlement larger than the debt is accepted: the
 * counterparty then owes the difference (decision of 2026-11-12).
 */
export function recordSettlement(input: SettlementInput, context: SettlementContext): Result<Settlement, SettlementRefusal> {
  if (!CANONICAL_UUID.test(input.id)) return err({ kind: 'InvalidId', expected: 'SettlementId' });
  const paidOn = BusinessDay(input.paidOn);
  if (!paidOn.ok) return err({ kind: 'InvalidBusinessDay' });
  if (paidOn.value > context.today) return err({ kind: 'PaidInFuture' });
  const amount = Money.of(input.amount, context.currency);
  if (!amount.ok || amount.value.amount === 0) return err({ kind: 'InvalidAmount' });
  if (!(PAYMENT_METHODS as readonly string[]).includes(input.method)) return err({ kind: 'UnknownPaymentMethod' });
  if (!(SETTLEMENT_DIRECTIONS as readonly string[]).includes(input.direction)) return err({ kind: 'UnknownDirection' });
  const counterparty = context.counterparties.find((one) => one.id === input.counterpartyId);
  if (counterparty === undefined) return err({ kind: 'UnknownCounterparty' });
  if (counterparty.archived) return err({ kind: 'CounterpartyArchived' });
  return ok(
    Object.freeze({ id: input.id as SettlementId, counterpartyId: input.counterpartyId as CounterpartyId, paidOn: paidOn.value, amount: amount.value, method: input.method, direction: input.direction }),
  );
}
