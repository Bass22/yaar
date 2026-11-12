/**
 * Answer of GET /api/v1/campaigns/:id/tracking (admin only, V.3): the figures of a lot's « Suivi »,
 * each recomputed by the server. A figure without data is `null`, never zero.
 */
export interface TrackingView {
  readonly campaignId: string;
  readonly currency: string;
  /** The strain placed (`Cobb500`): the curve and the feed are read against its table. */
  readonly strain: string;
  /** Today's day of the flock, at the site's time zone, and the planned duration. */
  readonly campaignDay: number;
  readonly plannedDuration: number;
  /** Committed ÷ birds (P.1); `null` while the birds alive are unknown. */
  readonly costPerBird: number | null;
  readonly received: number;
  readonly deaths: number;
  /** Deaths ÷ chicks received, to the thousandth; `null` before any chick is received. */
  readonly mortality: number | null;
  /** The feed eaten (V.1), grams per bird. */
  readonly feed: {
    readonly bagsOpened: number;
    readonly cumulative: number | null;
    readonly target: number | null;
    readonly variance: number | null;
    readonly feedConversion: { readonly campaignDay: number; readonly value: number; readonly target: number | null } | null;
  };
  /** Validated weighings, earliest first (V.2). */
  readonly curve: readonly { readonly weighingId: string; readonly campaignDay: number; readonly average: number }[];
  /** From the first sale only (shown by phase): margin, average price per bird, left to sell. */
  readonly sales: { readonly margin: number | null; readonly averagePrice: number | null; readonly remaining: number | null } | null;
}
