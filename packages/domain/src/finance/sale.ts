import { err, Money, ok, SignedMoney, type Brand, type CurrencyCode, type Result } from '@kit';
import { BusinessDay } from '../journal/business-day';
import type { CampaignId } from '../journal/ids';
import type { CounterpartyKind } from './counterparty';
import type { LedgerEntry } from './ledger';
import { PAYMENT_METHODS, type PaymentMethod } from './order-balance';
import type { CounterpartyId } from './purchase-order';
import { isCanonicalUuid } from '../journal/ids';

export type SaleId = Brand<string, 'SaleId'>;
export type SaleReceiptId = Brand<string, 'SaleReceiptId'>;

/** How the price was set, chosen at each sale (decision of 2026-11-12): a head, or a kilo of the weight weighed. */
export type SalePricing = { readonly kind: 'PerBird'; readonly unitPrice: Money } | { readonly kind: 'PerKilo'; readonly grams: number; readonly pricePerKilo: Money };

/** A sale of birds of a campaign (W.1): a money entry, written once and never changed. Its amount is computed. */
export type Sale = {
  readonly id: SaleId;
  readonly campaignId: CampaignId;
  readonly buyerId: CounterpartyId;
  readonly soldOn: BusinessDay;
  /** Birds that leave the flock: the live count goes down by as many. */
  readonly birds: number;
  readonly pricing: SalePricing;
  readonly amount: Money;
};

export type SaleInput = {
  readonly id: string;
  readonly campaignId: string;
  readonly buyerId: string;
  readonly soldOn: string;
  readonly birds: number;
  /** Whole units of the farm's currency; the weight in whole grams, as weighed. */
  readonly pricing: { readonly kind: 'PerBird'; readonly unitPrice: number } | { readonly kind: 'PerKilo'; readonly grams: number; readonly pricePerKilo: number };
};

/** Money received for a sale, at the sale or later (W.1): a money entry, written once. */
export type SaleReceipt = {
  readonly id: SaleReceiptId;
  readonly saleId: SaleId;
  readonly paidOn: BusinessDay;
  readonly amount: Money;
  readonly method: PaymentMethod;
};

export type SaleReceiptInput = { readonly id: string; readonly saleId: string; readonly paidOn: string; readonly amount: number; readonly method: PaymentMethod };

export type SaleContext = {
  readonly currency: CurrencyCode;
  readonly today: BusinessDay;
  readonly counterparties: readonly { readonly id: string; readonly kind: CounterpartyKind; readonly archived: boolean }[];
};

export type SaleRefusal =
  | { readonly kind: 'InvalidId'; readonly expected: 'SaleId' | 'CampaignId' | 'SaleReceiptId' }
  | { readonly kind: 'InvalidBusinessDay' }
  | { readonly kind: 'SoldInFuture' }
  | { readonly kind: 'PaidInFuture' }
  | { readonly kind: 'InvalidBirds' }
  | { readonly kind: 'InvalidPrice' }
  | { readonly kind: 'InvalidWeight' }
  | { readonly kind: 'UnknownPricing' }
  | { readonly kind: 'InvalidAmount' }
  | { readonly kind: 'UnknownPaymentMethod' }
  | { readonly kind: 'UnknownCounterparty' }
  | { readonly kind: 'CounterpartyArchived' }
  /** Birds are sold to a customer, never to a supplier or a collaborator. */
  | { readonly kind: 'NotACustomer' };


/** A sale (W.1), judged against the farm: a customer in use, at least one bird, a price, a day not ahead of today. */
export function recordSale(input: SaleInput, context: SaleContext): Result<Sale, SaleRefusal> {
  if (!isCanonicalUuid(input.id)) return err({ kind: 'InvalidId', expected: 'SaleId' });
  if (!isCanonicalUuid(input.campaignId)) return err({ kind: 'InvalidId', expected: 'CampaignId' });
  const soldOn = BusinessDay(input.soldOn);
  if (!soldOn.ok) return err({ kind: 'InvalidBusinessDay' });
  if (soldOn.value > context.today) return err({ kind: 'SoldInFuture' });
  if (!Number.isInteger(input.birds) || input.birds < 1) return err({ kind: 'InvalidBirds' });
  const pricing = pricingOf(input.pricing, context.currency);
  if (!pricing.ok) return pricing;
  const buyer = context.counterparties.find((one) => one.id === input.buyerId);
  if (buyer === undefined) return err({ kind: 'UnknownCounterparty' });
  if (buyer.archived) return err({ kind: 'CounterpartyArchived' });
  if (buyer.kind !== 'Customer') return err({ kind: 'NotACustomer' });
  const amount = saleAmount(input.birds, pricing.value);
  if (amount === null) return err({ kind: 'InvalidPrice' });
  return ok(Object.freeze({ id: input.id as SaleId, campaignId: input.campaignId as CampaignId, buyerId: input.buyerId as CounterpartyId, soldOn: soldOn.value, birds: input.birds, pricing: pricing.value, amount }));
}

/** What a sale comes to: birds × the price of a head, or grams × the price of a kilo ÷ 1 000, to the nearest unit. */
export function saleAmount(birds: number, pricing: SalePricing): Money | null {
  const amount = pricing.kind === 'PerBird' ? pricing.unitPrice.times(birds) : Money.of(Math.round((pricing.grams * pricing.pricePerKilo.amount) / 1000), pricing.pricePerKilo.currency);
  return amount.ok ? amount.value : null;
}

function pricingOf(pricing: SaleInput['pricing'], currency: CurrencyCode): Result<SalePricing, SaleRefusal> {
  if (pricing?.kind === 'PerBird') {
    const unitPrice = Money.of(pricing.unitPrice, currency);
    return unitPrice.ok && unitPrice.value.amount > 0 ? ok({ kind: 'PerBird', unitPrice: unitPrice.value }) : err({ kind: 'InvalidPrice' });
  }
  if (pricing?.kind === 'PerKilo') {
    if (!Number.isInteger(pricing.grams) || pricing.grams < 1) return err({ kind: 'InvalidWeight' });
    const pricePerKilo = Money.of(pricing.pricePerKilo, currency);
    return pricePerKilo.ok && pricePerKilo.value.amount > 0 ? ok({ kind: 'PerKilo', grams: pricing.grams, pricePerKilo: pricePerKilo.value }) : err({ kind: 'InvalidPrice' });
  }
  return err({ kind: 'UnknownPricing' });
}

/** Money received for a sale: at least one unit, a method, a day not ahead of today. More than the sale is allowed. */
export function recordSaleReceipt(input: SaleReceiptInput, context: Pick<SaleContext, 'currency' | 'today'>): Result<SaleReceipt, SaleRefusal> {
  if (!isCanonicalUuid(input.id)) return err({ kind: 'InvalidId', expected: 'SaleReceiptId' });
  if (!isCanonicalUuid(input.saleId)) return err({ kind: 'InvalidId', expected: 'SaleId' });
  const paidOn = BusinessDay(input.paidOn);
  if (!paidOn.ok) return err({ kind: 'InvalidBusinessDay' });
  if (paidOn.value > context.today) return err({ kind: 'PaidInFuture' });
  const amount = Money.of(input.amount, context.currency);
  if (!amount.ok || amount.value.amount === 0) return err({ kind: 'InvalidAmount' });
  if (!(PAYMENT_METHODS as readonly string[]).includes(input.method)) return err({ kind: 'UnknownPaymentMethod' });
  return ok(Object.freeze({ id: input.id as SaleReceiptId, saleId: input.saleId as SaleId, paidOn: paidOn.value, amount: amount.value, method: input.method }));
}

/** At the ledger, the buyer owes each sale; each receipt, once, lowers it (R.1, W.1). */
export function saleEntries(sales: readonly Sale[], receipts: readonly SaleReceipt[]): LedgerEntry[] {
  const buyerOf = new Map(sales.map((sale) => [sale.id as string, sale.buyerId]));
  const entries: LedgerEntry[] = sales.map((sale) => ({ counterpartyId: sale.buyerId, on: sale.soldOn, amount: SignedMoney.fromMoney(sale.amount), source: { kind: 'Sale', saleId: sale.id } }));
  for (const receipt of unique(receipts)) {
    const buyer = buyerOf.get(receipt.saleId);
    if (buyer === undefined) continue;
    const amount = SignedMoney.of(-receipt.amount.amount, receipt.amount.currency);
    if (!amount.ok) throw new RangeError('A receipt has no signed amount.');
    entries.push({ counterpartyId: buyer, on: receipt.paidOn, amount: amount.value, source: { kind: 'SaleReceipt', saleId: receipt.saleId, method: receipt.method } });
  }
  return entries;
}

/** The money of a campaign's sales (W.1): revenue, cashed in, live margin, average price a bird. */
export type SalesSummary = {
  readonly birdsSold: number;
  readonly revenue: Money;
  readonly cashedIn: Money;
  /** Cashed in − committed; absent before the first sale. */
  readonly margin: SignedMoney | null;
  /** Revenue ÷ birds sold, to the nearest unit; absent before the first sale. */
  readonly averagePrice: Money | null;
};

export function salesSummary(sales: readonly Sale[], receipts: readonly SaleReceipt[], committed: Money, currency: CurrencyCode): SalesSummary {
  const own = new Set(sales.map((sale) => sale.id as string));
  const revenue = sum(sales.map((sale) => sale.amount), currency);
  const cashedIn = sum(unique(receipts).filter((receipt) => own.has(receipt.saleId)).map((receipt) => receipt.amount), currency);
  const birdsSold = sales.reduce((total, sale) => total + sale.birds, 0);
  if (birdsSold === 0) return { birdsSold, revenue, cashedIn, margin: null, averagePrice: null };
  const margin = SignedMoney.fromMoney(cashedIn).subtract(SignedMoney.fromMoney(committed));
  const average = Money.of(Math.round(revenue.amount / birdsSold), currency);
  if (!margin.ok || !average.ok) throw new RangeError('The sales cannot be summed in one currency.');
  return { birdsSold, revenue, cashedIn, margin: margin.value, averagePrice: average.value };
}

function unique<T extends { readonly id: string }>(items: readonly T[]): T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function sum(amounts: readonly Money[], currency: CurrencyCode): Money {
  let total = Money.zero(currency);
  for (const amount of amounts) {
    const next = total.add(amount);
    if (!next.ok) throw new RangeError('Amounts in another currency.');
    total = next.value;
  }
  return total;
}
