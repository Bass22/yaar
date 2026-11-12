// Closing a campaign at the office (X.2). Online only, like the opening: money is in it.

export interface LeftoverRequest {
  readonly costTypeId: string;
  /** Whole bags or units left, 0 or more. */
  readonly whole: number;
  /** One more opened and not finished, counted for half. */
  readonly opened: boolean;
}

export interface CloseCampaignRequest {
  /** What is left; an empty list says « nothing left ». */
  readonly leftovers: readonly LeftoverRequest[];
  /** The campaign of the same site that receives the leftovers; `null` without leftovers. */
  readonly leftoversTo: string | null;
  /** The admin's free comment on the report; `null` or empty: none. */
  readonly comment: string | null;
}

export type CampaignClosingRefusal =
  | { readonly kind: 'InvalidRequest' }
  | { readonly kind: 'CampaignNotFound' }
  | { readonly kind: 'CampaignClosed' }
  | { readonly kind: 'UnknownCostType'; readonly costTypeId: string }
  | { readonly kind: 'NotALeftover'; readonly costTypeId: string }
  | { readonly kind: 'InvalidQuantity'; readonly costTypeId: string }
  | { readonly kind: 'EmptyLeftover'; readonly costTypeId: string }
  | { readonly kind: 'DuplicateType'; readonly costTypeId: string }
  | { readonly kind: 'InvalidId'; readonly costTypeId?: string }
  | { readonly kind: 'LeftoversWithoutReceiver' }
  | { readonly kind: 'UnknownReceiver' }
  | { readonly kind: 'SameCampaign' }
  | { readonly kind: 'OtherSite' }
  | { readonly kind: 'DestinationClosed' }
  | { readonly kind: 'CommentTooLong'; readonly max: number };

/** A leftover as the report shows it; its value is absent — never zero — when it is unknown. */
export interface LeftoverView {
  readonly costTypeId: string;
  readonly name: string;
  readonly unit: 'bag' | 'unit';
  readonly whole: number;
  readonly opened: boolean;
  readonly value: number | null;
}

/** The report of a closed campaign (X.1, X.2). Amounts in whole units of `currency`. */
export interface ClosingReportView {
  readonly campaignId: string;
  readonly siteName: string;
  readonly placementDay: string;
  /** When it was closed (UTC instant). */
  readonly closedAt: string;
  readonly currency: string;
  readonly chicksReceived: number;
  readonly deaths: number;
  readonly losses: number;
  readonly birdsSold: number;
  readonly costs: number;
  readonly leftovers: readonly LeftoverView[];
  /** The campaign that received them, as the office names it; `null` without leftovers. */
  readonly leftoversTo: { readonly campaignId: string; readonly siteName: string; readonly placementDay: string } | null;
  readonly leftoversValue: number;
  readonly netCost: number;
  readonly revenue: number;
  readonly cashedIn: number;
  readonly costPerBird: number | null;
  readonly revenuePerChick: number | null;
  readonly profit: number;
  readonly comment: string | null;
}

/** A closed campaign in the list of the office: its report is one tap away. */
export interface ClosedLotView {
  readonly campaignId: string;
  readonly siteName: string;
  readonly placementDay: string;
  readonly closedAt: string;
}
