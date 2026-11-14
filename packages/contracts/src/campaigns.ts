// Opening a campaign at the office (O.2). Online only: the rest of the office needs the network.

export interface OpenCampaignRequest {
  /** Created by the office (UUID), like every identifier. */
  readonly id: string;
  readonly siteId: string;
  /** A strain of the publisher (`Cobb500`). */
  readonly strain: string;
  /** Chicks expected: for budgets and ratios, never the base of the live count. */
  readonly plannedHeadcount: number;
  /** `YYYY-MM-DD`, never after the site's today, at most 60 days back. */
  readonly placementDay: string;
  /** Whole days, 1 to 60. */
  readonly plannedDuration: number;
}

export type CampaignOpeningRefusal =
  | { readonly kind: 'InvalidRequest' }
  | { readonly kind: 'UnknownStrain' }
  | { readonly kind: 'InvalidQuantity'; readonly value: number }
  | { readonly kind: 'InvalidBusinessDay' }
  | { readonly kind: 'PlacementTooFarAhead' }
  | { readonly kind: 'PlacementTooOld' }
  | { readonly kind: 'InvalidPlannedDuration'; readonly value: number }
  | { readonly kind: 'CampaignAlreadyExists' }
  | { readonly kind: 'SiteNotFound' };
