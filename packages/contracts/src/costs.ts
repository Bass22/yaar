// The costs of a campaign at the office (P.3). Admin only: amounts never go to the caretaker.

/** Paid by the farm; to pay to someone (P.1); or paid for the farm by someone (R.4). */
export type CostPaymentView = { readonly kind: 'Paid' } | { readonly kind: 'ToPay' | 'PaidBy'; readonly counterpartyId: string };

/** Body of POST /api/v1/costs, and of POST /api/v1/costs/:id/revisions (the cost written again whole). */
export interface RecordCostRequest {
  /** Created by the office (UUID). For a revision, the counter-entry's own identifier. */
  readonly id: string;
  readonly campaignId: string;
  readonly costTypeId: string;
  /** `YYYY-MM-DD`, never after the site's today. */
  readonly spentOn: string;
  /** Whole units of the farm's currency, at least 1. */
  readonly amount: number;
  readonly note: string | null;
  readonly payment: CostPaymentView;
  /** The fingerprint of the receipt's photo, sent first to /api/v1/media (P.5). */
  readonly receipt: string | null;
  /** When it was written, on the device's clock (P.7): a cost from the office's queue carries it; without it, the server's. */
  readonly recordedAt?: string;
}

/** One entry written for a cost: the first, or a counter-entry. */
export interface CostEntryView {
  readonly id: string;
  readonly recordedAt: string;
  readonly recordedBy: string;
  readonly spentOn: string;
  readonly amount: number;
  readonly payment: CostPaymentView;
}

/** A cost as it counts — its latest entry —, under the identifier it was first written with. */
export interface CostView {
  readonly id: string;
  readonly costTypeId: string;
  readonly spentOn: string;
  readonly amount: number;
  /** Never cut. */
  readonly note: string | null;
  readonly payment: CostPaymentView;
  readonly receipt: string | null;
  /** Every entry, earliest written first. */
  readonly history: readonly CostEntryView[];
}

/** Answer of GET /api/v1/campaigns/:id/money: the money of a campaign, computed by the server. */
export interface CampaignMoneyView {
  readonly campaignId: string;
  readonly currency: string;
  /** Costs plus the billable of the orders, in whole units of `currency`. */
  readonly committed: number;
  /** Birds alive today; `null` while unknown. */
  readonly liveCount: number | null;
  /** `committed ÷ liveCount`, to the nearest unit; `null` while the live count is unknown or not above zero. */
  readonly costPerBird: number | null;
  /** Earliest spent first. */
  readonly costs: readonly CostView[];
}

export type CostRefusalCode =
  | 'InvalidRequest'
  | 'InvalidId'
  | 'InvalidBusinessDay'
  | 'InvalidInstant'
  | 'SpentInFuture'
  | 'InvalidAmount'
  | 'NoteTooLong'
  | 'InvalidMediaFingerprint'
  | 'UnknownCostType'
  | 'CostTypeArchived'
  | 'UnknownCounterparty'
  | 'CounterpartyArchived'
  | 'NotACreditor'
  | 'CorrectsACorrection'
  | 'CorrectsItself'
  | 'CorrectionChangesCampaign'
  | 'UnknownCampaign'
  | 'CampaignClosed'
  | 'CostAlreadyExists'
  | 'CostNotFound';

export interface CostRefusal {
  readonly kind: CostRefusalCode;
}
