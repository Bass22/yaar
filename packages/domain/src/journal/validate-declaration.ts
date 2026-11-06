import { err, ok, type Result } from '@kit';
import { recentBusinessDays, type TimeZone } from './business-day';
import type { Campaign } from './campaign';
import type { JournalEvent } from './journal-event';
import type { Refusal } from './refusal';
import type { Role } from './role';

export type DeclarationContext = {
  /** The campaign the event names. */
  readonly campaign: Campaign;
  /** The time zone of the site: it says which day it was when the event was written. */
  readonly timeZone: TimeZone;
  readonly authorRole: Role;
};

/**
 * Refuses an event that its campaign cannot take. Every rule is judged at the moment the
 * event was written (`recordedAt`, the clock of its author), never at the moment it is read:
 * the function takes no clock, so a declaration kept offline for a week gets the same answer
 * on the server as on the phone. A counter-declaration is judged the same way; what makes it
 * a correction is checked by `validateCounterDeclaration`, which ends here.
 */
export const validateDeclaration = <Event extends JournalEvent>(
  event: Event,
  context: DeclarationContext,
): Result<Event, Refusal> => {
  const { campaign, timeZone, authorRole } = context;
  if (campaign.id !== event.campaignId) {
    throw new TypeError('A declaration is validated against its own campaign.');
  }
  if (campaign.siteId !== event.siteId) {
    return err({ kind: 'SiteNotOfCampaign' });
  }
  if (campaign.closedAt !== null && event.recordedAt >= campaign.closedAt) {
    return err({ kind: 'CampaignClosed' });
  }

  const { today, dayBeforeYesterday } = recentBusinessDays(new Date(event.recordedAt), timeZone);
  // Business days are written `YYYY-MM-DD`: they compare as texts.
  if (event.businessDate > today) {
    return err({ kind: 'FutureBusinessDate' });
  }
  if (event.businessDate < campaign.placementDay) {
    return err({ kind: 'BusinessDateBeforePlacement' });
  }
  // Only the admin fills an older day. Any other role gets the caretaker's three days.
  if (authorRole !== 'admin' && event.businessDate < dayBeforeYesterday) {
    return err({ kind: 'CatchUpWindowPassed' });
  }
  return ok(event);
};
