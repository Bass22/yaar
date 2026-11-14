import { err, Money, ok, type Brand, type CurrencyCode, type MoneyError, type Result } from '@kit';
import { BusinessDay } from '../journal/business-day';
import { CampaignId, OrderLineId, isCanonicalUuid } from '../journal/ids';
import type { Instant } from '../journal/instant';
import { Quantity } from '../journal/quantity';
import { Weight } from '../journal/weight';

export type PurchaseOrderId = Brand<string, 'PurchaseOrderId'>;
export type CounterpartyId = Brand<string, 'CounterpartyId'>;
export type CostTypeId = Brand<string, 'CostTypeId'>;

/** Closed list of the reasons an order is refused (Q.1); each case says what is needed to explain it. */
export type OrderRefusal =
  | { readonly kind: 'InvalidId'; readonly expected: 'PurchaseOrderId' | 'CounterpartyId' | 'CampaignId' | 'OrderLineId' | 'CostTypeId' }
  | { readonly kind: 'InvalidBusinessDay' }
  | { readonly kind: 'OrderWithoutLines' }
  | { readonly kind: 'UnknownCounterparty' }
  | { readonly kind: 'NotASupplier' }
  | { readonly kind: 'CounterpartyArchived' }
  | { readonly kind: 'UnknownCostType'; readonly lineId: string }
  | { readonly kind: 'CostTypeNotOrderable'; readonly lineId: string }
  | { readonly kind: 'CostTypeArchived'; readonly lineId: string }
  | { readonly kind: 'InvalidQuantity'; readonly lineId: string }
  | { readonly kind: 'InvalidUnitPrice'; readonly lineId: string }
  | { readonly kind: 'MissingBagWeight'; readonly lineId: string }
  | { readonly kind: 'UnexpectedBagWeight'; readonly lineId: string }
  | { readonly kind: 'InvalidBagWeight'; readonly lineId: string }
  | { readonly kind: 'DuplicateLine'; readonly lineId: string }
  /** Only a draft changes: once announced, the caretaker's card depends on it. */
  | { readonly kind: 'OrderAnnounced' }
  | { readonly kind: 'OrderIdChanged' }
  | { readonly kind: 'OrderAlreadyAnnounced' }
  | { readonly kind: 'OrderNotAnnounced' }
  | { readonly kind: 'OrderClosed' }
  | { readonly kind: 'OrderFullyReceived' };

export type OrderLine = {
  readonly id: OrderLineId;
  /** A cost type of the farm, under an orderable category. */
  readonly costTypeId: CostTypeId;
  readonly quantity: Quantity;
  readonly unitPrice: Money;
  /**
   * The weight of one bag of a feed line, in grams (N.8a): a fact of the purchase, copied from the
   * type's usual weight or written for this order; `null` for a line that is not feed.
   */
  readonly bagWeight: Weight | null;
};

export type PurchaseOrder = {
  readonly id: PurchaseOrderId;
  readonly supplierId: CounterpartyId;
  /** The campaign it serves, hence the site whose caretaker receives it (decision of 2026-11-09). */
  readonly campaignId: CampaignId;
  readonly orderDay: BusinessDay;
  /** The farm's currency: every amount of the order is in it (rule 7: never written in the code). */
  readonly currency: CurrencyCode;
  /** The supplier's slip number, when there is one. */
  readonly reference: string | null;
  readonly lines: readonly OrderLine[];
  readonly announcedAt: Instant | null;
  readonly closedAt: Instant | null;
};

/** What the admin types, before any check. Amounts in whole units of the farm's currency. */
export type DraftOrderInput = {
  readonly id: string;
  readonly supplierId: string;
  readonly campaignId: string;
  readonly orderDay: string;
  readonly reference: string | null;
  readonly lines: readonly { readonly id: string; readonly costTypeId: string; readonly quantity: number; readonly unitPrice: number; readonly bagWeight?: number | null }[];
};

/** Who and what the farm has: an order is judged against it. */
export type DraftOrderContext = {
  readonly currency: CurrencyCode;
  readonly counterparties: readonly { readonly id: string; readonly kind: 'Supplier' | 'Customer' | 'Collaborator'; readonly archived: boolean }[];
  readonly costTypes: readonly {
    readonly id: string;
    readonly category: string;
    /** The usual weight of its bag, in grams; `null` when none (feed bought by weight). */
    readonly bagWeight: number | null;
    readonly orderable: boolean;
    readonly archived: boolean;
  }[];
};

/** Deduced, never written: from the announcement, the closing, what each line received, and the payments. */
export type OrderStatus = 'Draft' | 'Announced' | 'PartiallyReceived' | 'Received' | 'Closed' | 'Settled';

const idAs = <Id extends string>(raw: string, expected: Extract<OrderRefusal, { kind: 'InvalidId' }>['expected']): Result<Id, OrderRefusal> =>
  isCanonicalUuid(raw) ? ok(raw as Id) : err({ kind: 'InvalidId', expected });

/** A draft order, judged whole: header, supplier, every line. The result is frozen. */
export const draftOrder = (input: DraftOrderInput, context: DraftOrderContext): Result<PurchaseOrder, OrderRefusal> => {
  const id = idAs<PurchaseOrderId>(input.id, 'PurchaseOrderId');
  if (!id.ok) return id;
  const supplierId = idAs<CounterpartyId>(input.supplierId, 'CounterpartyId');
  if (!supplierId.ok) return supplierId;
  const campaignId = CampaignId(input.campaignId);
  if (!campaignId.ok) return err({ kind: 'InvalidId', expected: 'CampaignId' });
  const orderDay = BusinessDay(input.orderDay);
  if (!orderDay.ok) return err({ kind: 'InvalidBusinessDay' });
  const supplier = context.counterparties.find((counterparty) => counterparty.id === supplierId.value);
  if (supplier === undefined) return err({ kind: 'UnknownCounterparty' });
  if (supplier.kind !== 'Supplier') return err({ kind: 'NotASupplier' });
  if (supplier.archived) return err({ kind: 'CounterpartyArchived' });
  if (input.lines.length === 0) return err({ kind: 'OrderWithoutLines' });

  const lines: OrderLine[] = [];
  for (const raw of input.lines) {
    const line = lineOf(raw, context);
    if (!line.ok) return line;
    if (lines.some(({ id: taken }) => taken === line.value.id)) return err({ kind: 'DuplicateLine', lineId: raw.id });
    lines.push(line.value);
  }
  const reference = input.reference?.trim() ?? '';
  return ok(
    Object.freeze({
      id: id.value,
      supplierId: supplierId.value,
      campaignId: campaignId.value,
      orderDay: orderDay.value,
      currency: context.currency,
      reference: reference === '' ? null : reference,
      lines: Object.freeze(lines),
      announcedAt: null,
      closedAt: null,
    }),
  );
};

function lineOf(raw: DraftOrderInput['lines'][number], context: DraftOrderContext): Result<OrderLine, OrderRefusal> {
  const id = OrderLineId(raw.id);
  if (!id.ok) return err({ kind: 'InvalidId', expected: 'OrderLineId' });
  const costTypeId = idAs<CostTypeId>(raw.costTypeId, 'CostTypeId');
  if (!costTypeId.ok) return costTypeId;
  const costType = context.costTypes.find((type) => type.id === costTypeId.value);
  if (costType === undefined) return err({ kind: 'UnknownCostType', lineId: raw.id });
  if (!costType.orderable) return err({ kind: 'CostTypeNotOrderable', lineId: raw.id });
  if (costType.archived) return err({ kind: 'CostTypeArchived', lineId: raw.id });
  const quantity = Quantity(raw.quantity);
  if (!quantity.ok) return err({ kind: 'InvalidQuantity', lineId: raw.id });
  const unitPrice = Money.of(raw.unitPrice, context.currency);
  if (!unitPrice.ok) return err({ kind: 'InvalidUnitPrice', lineId: raw.id });
  const bagWeight = bagWeightOf(raw.bagWeight ?? null, costType);
  if (!bagWeight.ok) return err({ kind: bagWeight.error, lineId: raw.id });
  return ok(Object.freeze({ id: id.value, costTypeId: costTypeId.value, quantity: quantity.value, unitPrice: unitPrice.value, bagWeight: bagWeight.value }));
}

// A feed line weighs its bag: written for this order, else the type's usual weight (N.8a).
function bagWeightOf(written: number | null, costType: DraftOrderContext['costTypes'][number]): Result<Weight | null, 'MissingBagWeight' | 'UnexpectedBagWeight' | 'InvalidBagWeight'> {
  if (costType.category !== 'Feed') return written === null ? ok(null) : err('UnexpectedBagWeight');
  const grams = written ?? costType.bagWeight;
  if (grams === null) return err('MissingBagWeight');
  const weight = Weight(grams);
  return weight.ok ? ok(weight.value) : err('InvalidBagWeight');
}

/** Only a draft changes, judged whole again, under the same identifier. */
export const reviseOrder = (order: PurchaseOrder, input: DraftOrderInput, context: DraftOrderContext): Result<PurchaseOrder, OrderRefusal> => {
  if (order.announcedAt !== null) return err({ kind: 'OrderAnnounced' });
  if (input.id !== order.id) return err({ kind: 'OrderIdChanged' });
  return draftOrder(input, context);
};

/** A draft is announced once: the caretaker of its site will see the delivery coming. */
export const announceOrder = (order: PurchaseOrder, at: Instant): Result<PurchaseOrder, OrderRefusal> =>
  order.announcedAt !== null ? err({ kind: 'OrderAlreadyAnnounced' }) : ok(Object.freeze({ ...order, announcedAt: at }));

/** Deliveries go to an announced order that is not closed. */
export const acceptsDeliveries = (order: PurchaseOrder): Result<void, OrderRefusal> => {
  if (order.announcedAt === null) return err({ kind: 'OrderNotAnnounced' });
  if (order.closedAt !== null) return err({ kind: 'OrderClosed' });
  return ok(undefined);
};

/** Closing an announced order not fully received — even nothing received: the rest will not come. Never reopened. */
export const closeOrder = (order: PurchaseOrder, received: ReadonlyMap<string, number>, at: Instant): Result<PurchaseOrder, OrderRefusal> => {
  const open = acceptsDeliveries(order);
  if (!open.ok) return open;
  if (fullyReceived(order, received)) return err({ kind: 'OrderFullyReceived' });
  return ok(Object.freeze({ ...order, closedAt: at }));
};

/** The state of an order, deduced: `received` says what each line received; `paid` whether it is paid in full. */
export const orderStatus = (order: PurchaseOrder, received: ReadonlyMap<string, number>, paid: boolean): OrderStatus => {
  if (order.announcedAt === null) return 'Draft';
  const done = order.closedAt !== null || fullyReceived(order, received);
  if (done && paid) return 'Settled';
  if (order.closedAt !== null) return 'Closed';
  if (fullyReceived(order, received)) return 'Received';
  return order.lines.some((line) => (received.get(line.id) ?? 0) > 0) ? 'PartiallyReceived' : 'Announced';
};

// A bonus counts: a line is received once it has at least its quantity.
/** Every line received at least in full. */
export const fullyReceived = (order: PurchaseOrder, received: ReadonlyMap<string, number>): boolean => order.lines.every((line) => (received.get(line.id) ?? 0) >= line.quantity);

/** What the lines being typed come to, in the farm's currency: `Σ quantity × unit price`. Exact, never a float. */
export const orderedAmount = (lines: readonly { readonly quantity: number; readonly unitPrice: number }[], currency: CurrencyCode): Result<Money, MoneyError> => {
  let total = Money.zero(currency);
  for (const line of lines) {
    const unitPrice = Money.of(line.unitPrice, currency);
    if (!unitPrice.ok) return unitPrice;
    const amount = unitPrice.value.times(line.quantity);
    if (!amount.ok) return amount;
    const sum = total.add(amount.value);
    if (!sum.ok) return sum;
    total = sum.value;
  }
  return ok(total);
};
