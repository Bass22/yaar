import { err, ok, type Result } from '@kit';
import { BusinessDay, campaignDay } from './business-day';
import type { CampaignId, SiteId } from './ids';
import type { Instant } from './instant';
import { Quantity } from './quantity';
import type { Refusal } from './refusal';
import { STRAINS, type Strain } from './strain';

/** A flock on a site, as far as the field rules need to know it. */
export type Campaign = {
  readonly id: CampaignId;
  readonly siteId: SiteId;
  /** The day the chicks were placed. */
  readonly placementDay: BusinessDay;
  /** When the admin closed the campaign; `null` while it is running. */
  readonly closedAt: Instant | null;
};

/** The usual length of a campaign, offered when one is opened (decision of 2026-11-09). */
export const DEFAULT_PLANNED_DURATION = 45;
/** No campaign runs longer: the upper bound of a planned duration and of a resumed campaign's age. */
export const MAX_CAMPAIGN_DAYS = 60;

/** What the admin types to open a campaign, before any check. */
export type CampaignOpeningRequest = {
  readonly strain: string;
  /** Chicks expected: for budgets and ratios, never the base of the live count. */
  readonly plannedHeadcount: number;
  readonly placementDay: string;
  readonly plannedDuration: number;
};

export type CampaignOpening = {
  readonly strain: Strain;
  readonly plannedHeadcount: Quantity;
  readonly placementDay: BusinessDay;
  readonly plannedDuration: number;
};

/**
 * Opening a campaign, judged on the site's today: placement never in the future (the notebook
 * never shows a negative day), at most 60 days back (a campaign already running when the farm
 * starts with the app; older, it would be over).
 */
export const validateCampaignOpening = (request: CampaignOpeningRequest, today: BusinessDay): Result<CampaignOpening, Refusal> => {
  const strain = STRAINS.find(({ code }) => code === request.strain);
  if (strain === undefined) return err({ kind: 'UnknownStrain' });
  const plannedHeadcount = Quantity(request.plannedHeadcount);
  if (!plannedHeadcount.ok) return plannedHeadcount;
  const placementDay = BusinessDay(request.placementDay);
  if (!placementDay.ok) return placementDay;
  const age = campaignDay(placementDay.value, today);
  if (age < 0) return err({ kind: 'PlacementInFuture' });
  if (age > MAX_CAMPAIGN_DAYS) return err({ kind: 'PlacementTooOld' });
  const { plannedDuration } = request;
  if (!Number.isInteger(plannedDuration) || plannedDuration < 1 || plannedDuration > MAX_CAMPAIGN_DAYS) {
    return err({ kind: 'InvalidPlannedDuration', value: plannedDuration });
  }
  return ok({ strain, plannedHeadcount: plannedHeadcount.value, placementDay: placementDay.value, plannedDuration });
};
