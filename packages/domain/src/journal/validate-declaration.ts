import { err, ok, type Result } from '@kit';
import { recentBusinessDays, type TimeZone } from './business-day';
import type { Campaign } from './campaign';
import type { Author } from './declaration-policy';
import type { JournalEvent } from './journal-event';
import type { Refusal } from './refusal';

export type DeclarationContext = {
  /** The campaign the event names. */
  readonly campaign: Campaign;
  /** The time zone of the site: it says which day it was when the event was written. */
  readonly timeZone: TimeZone;
  /** The author of the event, with the role their session gives them: the form the policy takes too. */
  readonly author: Author;
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
  const { campaign, timeZone, author } = context;
  if (campaign.id !== event.campaignId || author.id !== event.authorId) {
    throw new TypeError('A declaration is validated against its own campaign and its own author.');
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
  // Before the placement, only what arrives for the flock: litter and feed come before the chicks (Q.11).
  if (event.businessDate < campaign.placementDay && !('type' in event && event.type === 'Delivery')) {
    return err({ kind: 'BusinessDateBeforePlacement' });
  }
  // Only the admin fills an older day. Any other role gets the caretaker's three days.
  if (author.role !== 'admin' && event.businessDate < dayBeforeYesterday) {
    return err({ kind: 'CatchUpWindowPassed' });
  }
  return ok(event);
};
