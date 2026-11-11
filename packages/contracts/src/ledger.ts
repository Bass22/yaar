// « Qui doit quoi » (R.3): the ledger of the farm's counterparties, computed by the server. Admin only.

import type { PaymentMethodCode } from './orders';

export type SettlementDirectionCode = 'ToCounterparty' | 'FromCounterparty';

/** Body of POST /api/v1/settlements (R.2). The identifier is made at the office: sent twice, kept once. */
export interface RecordSettlementRequest {
  readonly id: string;
  readonly counterpartyId: string;
  /** `YYYY-MM-DD`, never after today. */
  readonly paidOn: string;
  /** Whole units of the farm's currency, at least 1. */
  readonly amount: number;
  readonly method: PaymentMethodCode;
  readonly direction: SettlementDirectionCode;
}

export type LedgerSourceView =
  | { readonly kind: 'OrderReceived'; readonly orderId: string }
  | { readonly kind: 'OrderPayment'; readonly orderId: string; readonly method: PaymentMethodCode }
  | { readonly kind: 'Cost'; readonly costId: string }
  | { readonly kind: 'Settlement'; readonly method: PaymentMethodCode; readonly direction: SettlementDirectionCode };

export interface LedgerEntryView {
  /** `YYYY-MM-DD`. */
  readonly on: string;
  /** Signed from the farm's side: above zero the counterparty owes, below zero the farm owes. */
  readonly amount: number;
  readonly source: LedgerSourceView;
}

export interface CounterpartyLedgerView {
  readonly counterpartyId: string;
  /** Above zero: it owes you; below zero: you owe it; zero: settled. */
  readonly balance: number;
  /** Earliest first. */
  readonly entries: readonly LedgerEntryView[];
}

/** Answer of GET /api/v1/ledger. */
export interface LedgerView {
  readonly currency: string;
  /** What the farm owes, summed over the counterparties it owes: a positive number. */
  readonly youOwe: number;
  /** What is owed to the farm, summed likewise: a positive number. */
  readonly owedToYou: number;
  /** Largest balance first, the settled ones last. */
  readonly counterparties: readonly CounterpartyLedgerView[];
}

export type SettlementRefusalCode =
  | 'InvalidRequest'
  | 'InvalidId'
  | 'InvalidBusinessDay'
  | 'PaidInFuture'
  | 'InvalidAmount'
  | 'UnknownPaymentMethod'
  | 'UnknownDirection'
  | 'UnknownCounterparty'
  | 'CounterpartyArchived'
  | 'SettlementAlreadyExists';

export interface SettlementRefusal {
  readonly kind: SettlementRefusalCode;
}
