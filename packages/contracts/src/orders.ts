// Purchase orders at the office (Q.4). Admin only: prices never go to the caretaker.

export interface DraftOrderRequest {
  /** Created by the office (UUID), like every identifier. */
  readonly id: string;
  readonly supplierId: string;
  /** The campaign it serves: hence the site whose caretaker receives it. */
  readonly campaignId: string;
  /** `YYYY-MM-DD`. */
  readonly orderDay: string;
  /** The supplier's slip number, when there is one. */
  readonly reference: string | null;
  /** Amounts in whole units of the farm's currency. */
  /** `bagWeight`, in grams, for a feed line (N.8a): absent or `null`, the usual weight of its type. */
  readonly lines: readonly { readonly id: string; readonly costTypeId: string; readonly quantity: number; readonly unitPrice: number; readonly bagWeight?: number | null }[];
}

export type OrderStatusCode = 'Draft' | 'Announced' | 'PartiallyReceived' | 'Received' | 'Closed' | 'Settled';

export interface OrderView {
  readonly id: string;
  readonly supplierId: string;
  readonly campaignId: string;
  readonly orderDay: string;
  readonly reference: string | null;
  readonly currency: string;
  /** Deduced by the server from the journal and the payments. */
  readonly status: OrderStatusCode;
  /** `bagWeight`: one bag of a feed line, in grams (N.8a); `null` outside feed. */
  readonly lines: readonly { readonly id: string; readonly costTypeId: string; readonly quantity: number; readonly unitPrice: number; readonly bagWeight: number | null; readonly received: number }[];
  /** `min(received, quantity) × unit price`, summed: in whole units of `currency`. */
  readonly billable: number;
  /** The sum of `payments`. */
  readonly paid: number;
  /** Earliest paid first (Q.9). */
  readonly payments: readonly OrderPaymentView[];
  /** The photos joined to the order (R.6), by fingerprint, earliest first. */
  readonly attachments: readonly string[];
}

export type PaymentMethodCode = 'Cash' | 'Wave' | 'OrangeMoney';

export interface OrderPaymentView {
  readonly id: string;
  /** `YYYY-MM-DD`. */
  readonly paidOn: string;
  /** In whole units of the order's currency. */
  readonly amount: number;
  readonly method: PaymentMethodCode;
  /** Who paid for the farm (R.4); `null` when the farm paid. */
  readonly paidBy: string | null;
  /** The photos joined to the payment (R.6), by fingerprint, earliest first. */
  readonly attachments: readonly string[];
}

/** Body of POST /api/v1/orders/:id/payments (Q.9). The identifier is made at the office: sent twice, kept once. */
export interface RecordPaymentRequest {
  readonly id: string;
  /** `YYYY-MM-DD`. */
  readonly paidOn: string;
  /** Whole units of the farm's currency, at least 1. */
  readonly amount: number;
  readonly method: PaymentMethodCode;
  /** Someone else who paid for the farm (R.4): never the order's own supplier. Absent or null: the farm paid. */
  readonly paidBy?: string | null;
}

export type OrderRefusalCode =
  | 'InvalidRequest'
  | 'InvalidId'
  | 'InvalidBusinessDay'
  | 'OrderWithoutLines'
  | 'UnknownCounterparty'
  | 'NotASupplier'
  | 'PaidBySupplier'
  | 'CounterpartyArchived'
  | 'UnknownCostType'
  | 'CostTypeNotOrderable'
  | 'CostTypeArchived'
  | 'InvalidQuantity'
  | 'InvalidUnitPrice'
  | 'MissingBagWeight'
  | 'UnexpectedBagWeight'
  | 'InvalidBagWeight'
  | 'DuplicateLine'
  | 'UnknownCampaign'
  | 'CampaignClosed'
  | 'OrderAlreadyExists'
  | 'OrderNotFound'
  | 'OrderAnnounced'
  | 'OrderIdChanged'
  | 'OrderAlreadyAnnounced'
  | 'OrderNotAnnounced'
  | 'OrderClosed'
  | 'OrderFullyReceived'
  | 'InvalidAmount'
  | 'UnknownPaymentMethod'
  | 'PaymentAlreadyExists';

export interface OrderRefusal {
  readonly kind: OrderRefusalCode;
  /** The line concerned, when the refusal is about one. */
  readonly lineId?: string;
}

/** Body of POST /api/v1/attachments (R.6): a photo already sent to /api/v1/media, joined to an order or a payment. */
export interface AttachRequest {
  /** Created by the office (UUID). */
  readonly id: string;
  readonly subjectKind: 'Order' | 'Payment';
  readonly subjectId: string;
  /** The photo's fingerprint: SHA-256, 64 lowercase hexadecimal characters. */
  readonly media: string;
}

export type AttachRefusal = { readonly kind: 'InvalidRequest' } | { readonly kind: 'UnknownMedia' } | { readonly kind: 'UnknownSubject' };


/** Body of PUT /api/v1/orders/:id/receptions/:receptionId (Q.14): a writing of a planned reception — a new date reschedules it. */
export interface PlanReceptionRequest {
  /** Created by the office (UUID): the identifier of this writing. */
  readonly id: string;
  /** `YYYY-MM-DD`, not before the order's day. */
  readonly plannedOn: string;
  readonly lines: readonly { readonly orderLineId: string; readonly quantity: number }[];
}

export type ReceptionStateCode = 'Received' | 'Late' | 'Today' | 'Coming';

/** A planned reception as the office follows it (Q.14): what was received fills it, in the order of the days. */
export interface ReceptionView {
  readonly receptionId: string;
  readonly orderId: string;
  readonly supplierId: string;
  readonly campaignId: string;
  readonly plannedOn: string;
  /** The days it was planned on before being rescheduled, earliest first. */
  readonly previousDates: readonly string[];
  readonly state: ReceptionStateCode;
  readonly lines: readonly { readonly orderLineId: string; readonly costTypeId: string; readonly expected: number; readonly received: number; readonly remaining: number }[];
}

/** Answer of GET /api/v1/receptions (Q.14): the planned receptions of the orders still open, by day. Admin only. */
export interface ReceptionsView {
  readonly today: string;
  readonly receptions: readonly ReceptionView[];
}

export type PlanReceptionRefusalCode = 'InvalidRequest' | 'InvalidId' | 'InvalidBusinessDay' | 'BeforeOrderDay' | 'NoLines' | 'UnknownOrderLine' | 'InvalidQuantity' | 'DuplicateLine' | 'OrderNotReceiving';
