// The sales of a campaign at the office (W.3). Admin only: amounts never go to the caretaker.

import type { PaymentMethodCode } from './orders';

export type SalePricingView = { readonly kind: 'PerBird'; readonly unitPrice: number } | { readonly kind: 'PerKilo'; readonly grams: number; readonly pricePerKilo: number };

/** Money received for a sale: at the sale, or later. Its identifier is made at the office. */
export interface SaleReceiptRequest {
  readonly id: string;
  /** `YYYY-MM-DD`, never after today. */
  readonly paidOn: string;
  /** Whole units of the farm's currency, at least 1. */
  readonly amount: number;
  readonly method: PaymentMethodCode;
}

/** Body of POST /api/v1/sales. The amount is computed by the server, never sent. */
export interface RecordSaleRequest {
  readonly id: string;
  readonly campaignId: string;
  /** A counterparty of kind « customer ». */
  readonly buyerId: string;
  /** `YYYY-MM-DD`, never after today. */
  readonly soldOn: string;
  /** Birds that leave the flock. */
  readonly birds: number;
  readonly pricing: SalePricingView;
  /** What the buyer paid on the spot, dated the day of the sale; `null`: all on credit. */
  readonly receivedNow: { readonly id: string; readonly amount: number; readonly method: PaymentMethodCode } | null;
}

export interface SaleView {
  readonly id: string;
  readonly buyerId: string;
  readonly soldOn: string;
  readonly birds: number;
  readonly pricing: SalePricingView;
  readonly amount: number;
  /** The sum of its receipts. */
  readonly received: number;
  /** Earliest paid first. */
  readonly receipts: readonly { readonly id: string; readonly paidOn: string; readonly amount: number; readonly method: PaymentMethodCode }[];
}

/** Answer of GET /api/v1/campaigns/:id/sales: the money of the sales, computed by the server. */
export interface SalesView {
  readonly campaignId: string;
  readonly currency: string;
  readonly birdsSold: number;
  readonly revenue: number;
  readonly cashedIn: number;
  /** Cashed in − committed; `null` before the first sale. */
  readonly margin: number | null;
  /** Revenue ÷ birds sold; `null` before the first sale. */
  readonly averagePrice: number | null;
  /** Left to sell: the birds alive; `null` while unknown. */
  readonly remaining: number | null;
  /** Latest sold first. */
  readonly sales: readonly SaleView[];
}

export type SaleRefusalCode =
  | 'InvalidRequest'
  | 'InvalidId'
  | 'InvalidBusinessDay'
  | 'SoldInFuture'
  | 'PaidInFuture'
  | 'InvalidBirds'
  | 'InvalidPrice'
  | 'InvalidWeight'
  | 'UnknownPricing'
  | 'InvalidAmount'
  | 'UnknownPaymentMethod'
  | 'UnknownCounterparty'
  | 'CounterpartyArchived'
  | 'NotACustomer'
  | 'UnknownCampaign'
  | 'CampaignClosed'
  | 'SaleAlreadyExists'
  | 'SaleReceiptAlreadyExists'
  | 'SaleNotFound';

export interface SaleRefusal {
  readonly kind: SaleRefusalCode;
}
