import type { BusinessDay } from './business-day';
import type { CampaignId, SiteId } from './ids';
import type { Instant } from './instant';

/** A flock on a site, as far as the field rules need to know it. */
export type Campaign = {
  readonly id: CampaignId;
  readonly siteId: SiteId;
  /** The day the chicks were placed. */
  readonly placementDay: BusinessDay;
  /** When the admin closed the campaign; `null` while it is running. */
  readonly closedAt: Instant | null;
};
