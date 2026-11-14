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

/** A planned sale as the office reads it (W.4): buyer by buyer; amounts in whole units of the farm's currency. */
export interface SaleForecastView {
  readonly forecastId: string;
  readonly buyerId: string;
  /** A day of the week planned, `YYYY-MM-DD`. */
  readonly week: string;
  readonly birds: number;
  readonly pricing: { readonly kind: 'PerBird' | 'PerKilo'; readonly price: number };
  /** Grams: indicative by the bird, required by the kilo. */
  readonly averageWeight: number | null;
  /** What it brings, by the domain's rule. */
  readonly expectedRevenue: number;
}

/** Answer of GET /api/v1/campaigns/:id/sale-forecasts (W.4). Admin only. */
export interface SaleForecastsView {
  readonly currency: string;
  readonly closed: boolean;
  readonly forecasts: readonly SaleForecastView[];
  readonly expectedRevenue: number;
  /** The flock's budget, summed; `null` without a budget. */
  readonly budget: number | null;
  /** Expected revenue − budget, signed; `null` without a budget. */
  readonly expectedMargin: number | null;
  /** The revenue of the sales made. */
  readonly realized: number;
}

/** Body of PUT /api/v1/campaigns/:id/sale-forecasts/:forecastId (W.4): a writing of the planned sale, the last prevails. */
export interface RecordSaleForecastRequest {
  /** Created by the office (UUID): the identifier of this writing. */
  readonly id: string;
  readonly buyerId: string;
  readonly week: string;
  readonly birds: number;
  readonly pricing: { readonly kind: 'PerBird' | 'PerKilo'; readonly price: number };
  readonly averageWeight: number | null;
}

export type SaleForecastRefusalCode = 'InvalidRequest' | 'InvalidId' | 'UnknownBuyer' | 'InvalidBusinessDay' | 'WeekBeforePlacement' | 'InvalidBirds' | 'InvalidPrice' | 'InvalidWeight' | 'MissingWeight' | 'CampaignClosed';
