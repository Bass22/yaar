import { err, Money, ok, SignedMoney, type Brand, type CurrencyCode, type MoneyError, type Result } from '@kit';
import { BusinessDay } from '../journal/business-day';
import type { PurchaseOrder, PurchaseOrderId } from './purchase-order';

export type PaymentId = Brand<string, 'PaymentId'>;

/** How a payment was made: the list of the specification; another is added when one is seen. */
export const PAYMENT_METHODS = Object.freeze(['Cash', 'Wave', 'OrangeMoney'] as const);
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** A payment of an order: a money entry, written once and never changed (a counter-entry corrects it). */
export type Payment = {
  readonly id: PaymentId;
  readonly orderId: PurchaseOrderId;
  readonly paidOn: BusinessDay;
  readonly amount: Money;
  readonly method: PaymentMethod;
};

export type PaymentInput = {
  readonly id: string;
  readonly orderId: string;
  readonly paidOn: string;
  /** In whole units of the farm's currency, at least 1. */
  readonly amount: number;
  readonly method: PaymentMethod;
};

export type PaymentRefusal =
  | { readonly kind: 'InvalidId'; readonly expected: 'PaymentId' | 'PurchaseOrderId' }
  | { readonly kind: 'InvalidBusinessDay' }
  | { readonly kind: 'InvalidAmount' }
  | { readonly kind: 'UnknownPaymentMethod' };

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const recordPayment = (input: PaymentInput, currency: CurrencyCode): Result<Payment, PaymentRefusal> => {
  if (!CANONICAL_UUID.test(input.id)) return err({ kind: 'InvalidId', expected: 'PaymentId' });
  if (!CANONICAL_UUID.test(input.orderId)) return err({ kind: 'InvalidId', expected: 'PurchaseOrderId' });
  const paidOn = BusinessDay(input.paidOn);
  if (!paidOn.ok) return err({ kind: 'InvalidBusinessDay' });
  const amount = Money.of(input.amount, currency);
  if (!amount.ok || amount.value.amount === 0) return err({ kind: 'InvalidAmount' });
  if (!(PAYMENT_METHODS as readonly string[]).includes(input.method)) return err({ kind: 'UnknownPaymentMethod' });
  return ok(Object.freeze({ id: input.id as PaymentId, orderId: input.orderId as PurchaseOrderId, paidOn: paidOn.value, amount: amount.value, method: input.method }));
};

export type Billable = {
  readonly lines: readonly { readonly lineId: string; readonly billable: Money }[];
  readonly total: Money;
};

/**
 * Billable, line by line: `min(received, quantity) × unit price`. A bonus is not billed, a
 * shortfall is billed less. It arises at the delivery — neither at the order nor at the payment.
 */
export const billableOf = (order: PurchaseOrder, received: ReadonlyMap<string, number>): Result<Billable, MoneyError> => {
  const lines: { lineId: string; billable: Money }[] = [];
  let total = Money.zero(order.currency);
  for (const line of order.lines) {
    const billable = line.unitPrice.times(Math.min(received.get(line.id) ?? 0, line.quantity));
    if (!billable.ok) return billable;
    const sum = total.add(billable.value);
    if (!sum.ok) return sum;
    total = sum.value;
    lines.push({ lineId: line.id, billable: billable.value });
  }
  return ok({ lines, total });
};

export type OrderBalance = {
  readonly billable: Money;
  readonly paid: Money;
  /** `paid − billable`: below zero the farm owes the supplier, above zero the supplier owes the farm. */
  readonly debt: SignedMoney;
  readonly paidInFull: boolean;
};

/** The balance of an order: its billable, its payments (each counted once, whatever their order), and the signed debt. */
export const orderBalance = (order: PurchaseOrder, received: ReadonlyMap<string, number>, payments: readonly Payment[]): Result<OrderBalance, MoneyError> => {
  const billable = billableOf(order, received);
  if (!billable.ok) return billable;
  const seen = new Set<string>();
  let paid = Money.zero(billable.value.total.currency);
  for (const payment of payments) {
    if (payment.orderId !== order.id || seen.has(payment.id)) continue;
    seen.add(payment.id);
    const sum = paid.add(payment.amount);
    if (!sum.ok) return sum;
    paid = sum.value;
  }
  const debt = SignedMoney.fromMoney(paid).subtract(SignedMoney.fromMoney(billable.value.total));
  if (!debt.ok) return debt;
  return ok({ billable: billable.value.total, paid, debt: debt.value, paidInFull: debt.value.amount === 0 });
};
