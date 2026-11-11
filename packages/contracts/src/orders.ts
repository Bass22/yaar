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
  readonly lines: readonly { readonly id: string; readonly costTypeId: string; readonly quantity: number; readonly unitPrice: number }[];
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
  readonly lines: readonly { readonly id: string; readonly costTypeId: string; readonly quantity: number; readonly unitPrice: number; readonly received: number }[];
  /** `min(received, quantity) × unit price`, summed: in whole units of `currency`. */
  readonly billable: number;
  /** The sum of `payments`. */
  readonly paid: number;
  /** Earliest paid first (Q.9). */
  readonly payments: readonly OrderPaymentView[];
}

export type PaymentMethodCode = 'Cash' | 'Wave' | 'OrangeMoney';

export interface OrderPaymentView {
  readonly id: string;
  /** `YYYY-MM-DD`. */
  readonly paidOn: string;
  /** In whole units of the order's currency. */
  readonly amount: number;
  readonly method: PaymentMethodCode;
}

/** Body of POST /api/v1/orders/:id/payments (Q.9). The identifier is made at the office: sent twice, kept once. */
export interface RecordPaymentRequest {
  readonly id: string;
  /** `YYYY-MM-DD`. */
  readonly paidOn: string;
  /** Whole units of the farm's currency, at least 1. */
  readonly amount: number;
  readonly method: PaymentMethodCode;
}

export type OrderRefusalCode =
  | 'InvalidRequest'
  | 'InvalidId'
  | 'InvalidBusinessDay'
  | 'OrderWithoutLines'
  | 'UnknownCounterparty'
  | 'NotASupplier'
  | 'CounterpartyArchived'
  | 'UnknownCostType'
  | 'CostTypeNotOrderable'
  | 'CostTypeArchived'
  | 'InvalidQuantity'
  | 'InvalidUnitPrice'
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
