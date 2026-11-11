import { SignedMoney, type CurrencyCode } from '@kit';
import type { BusinessDay } from '../journal/business-day';
import type { CostHistory } from './cost';
import { billableOf, type Payment, type PaymentMethod } from './order-balance';
import type { PurchaseOrder } from './purchase-order';
import type { Settlement, SettlementDirection } from './settlement';

/** Where an entry of the ledger comes from. */
export type LedgerSource =
  | { readonly kind: 'OrderReceived'; readonly orderId: string }
  | { readonly kind: 'OrderPayment'; readonly orderId: string; readonly paymentId: string; readonly method: PaymentMethod }
  | { readonly kind: 'Cost'; readonly costId: string }
  | { readonly kind: 'Settlement'; readonly settlementId: string; readonly method: PaymentMethod; readonly direction: SettlementDirection };

/**
 * One line of a counterparty's ledger (R.1): signed from the farm's side — above zero the
 * counterparty owes the farm, below zero the farm owes it.
 */
export type LedgerEntry = {
  readonly counterpartyId: string;
  readonly on: BusinessDay;
  readonly amount: SignedMoney;
  readonly source: LedgerSource;
};

/** A counterparty's balance and its entries, earliest first. Never stored: always summed again. */
export type CounterpartyBalance = {
  readonly counterpartyId: string;
  /** Above zero: it owes you; below zero: you owe it; zero: settled. */
  readonly balance: SignedMoney;
  readonly entries: readonly LedgerEntry[];
};

/**
 * What an order puts in its supplier's ledger: its billable — what was received — as a debt, and
 * each of its payments, once, as reducing it (Q.3, Q.9). Nothing while nothing is received or paid.
 */
export function orderEntries(order: PurchaseOrder, received: ReadonlyMap<string, number>, payments: readonly Payment[]): LedgerEntry[] {
  const billable = billableOf(order, received);
  if (!billable.ok) throw new RangeError(`Order ${order.id} has no computable billable.`);
  const entries: LedgerEntry[] = [];
  if (billable.value.total.amount > 0) {
    entries.push({ counterpartyId: order.supplierId, on: order.orderDay, amount: negated(billable.value.total.amount, order.currency), source: { kind: 'OrderReceived', orderId: order.id } });
  }
  const seen = new Set<string>();
  for (const payment of payments) {
    if (payment.orderId !== order.id || seen.has(payment.id)) continue;
    seen.add(payment.id);
    entries.push({ counterpartyId: order.supplierId, on: payment.paidOn, amount: SignedMoney.fromMoney(payment.amount), source: { kind: 'OrderPayment', orderId: order.id, paymentId: payment.id, method: payment.method } });
  }
  return entries;
}

/** A cost still owed is a debt to the counterparty chosen; once paid, it no longer counts (P.1). */
export function costEntries(costs: readonly CostHistory[]): LedgerEntry[] {
  return costs.flatMap(({ id, current }) =>
    current.payment.kind === 'ToPay'
      ? [{ counterpartyId: current.payment.counterpartyId, on: current.spentOn, amount: negated(current.amount.amount, current.amount.currency), source: { kind: 'Cost' as const, costId: id } }]
      : [],
  );
}

/** Money given to the counterparty lowers what you owe it; money received from it lowers what it owes you (R.2). Each once. */
export function settlementEntries(settlements: readonly Settlement[]): LedgerEntry[] {
  const byId = new Map(settlements.map((settlement) => [settlement.id as string, settlement]));
  return [...byId.values()].map((settlement) => ({
    counterpartyId: settlement.counterpartyId,
    on: settlement.paidOn,
    amount: settlement.direction === 'ToCounterparty' ? SignedMoney.fromMoney(settlement.amount) : negated(settlement.amount.amount, settlement.amount.currency),
    source: { kind: 'Settlement', settlementId: settlement.id, method: settlement.method, direction: settlement.direction },
  }));
}

/**
 * The ledger of the counterparties (R.1): for each one that has an entry, the sum of its entries —
 * whatever their order — and the entries themselves, earliest first. No balance is ever stored.
 */
export function ledgerOf(entries: readonly LedgerEntry[], currency: CurrencyCode): CounterpartyBalance[] {
  const byCounterparty = new Map<string, LedgerEntry[]>();
  for (const entry of entries) {
    byCounterparty.set(entry.counterpartyId, [...(byCounterparty.get(entry.counterpartyId) ?? []), entry]);
  }
  return [...byCounterparty].map(([counterpartyId, own]) => {
    let balance = zero(currency);
    for (const { amount } of own) {
      const sum = balance.add(amount);
      if (!sum.ok) throw new RangeError('A ledger is kept in one currency.');
      balance = sum.value;
    }
    return { counterpartyId, balance, entries: [...own].sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0)) };
  });
}

function zero(currency: CurrencyCode): SignedMoney {
  const value = SignedMoney.of(0, currency);
  if (!value.ok) throw new RangeError(`No money in ${currency}.`);
  return value.value;
}

function negated(amount: number, currency: CurrencyCode): SignedMoney {
  const value = SignedMoney.of(-amount, currency);
  if (!value.ok) throw new RangeError(`No money in ${currency}.`);
  return value.value;
}
