import { effectiveJournal } from './counter-declaration';
import type { CampaignId, OrderLineId } from './ids';
import type { JournalEvent } from './journal-event';

export type LiveCountContext = {
  readonly campaignId: CampaignId;
  /** The order lines that deliver the animals placed in the campaign: the journal cannot tell them from feed. */
  readonly placementOrderLines: readonly OrderLineId[];
};

export type LiveCount = {
  /** Animals actually received, bonus included: the ordered quantity plays no part. */
  readonly received: number;
  readonly deaths: number;
  /** Losses that are not deaths: missing, given away. They never count as mortality. */
  readonly losses: number;
  /** `received − deaths − losses`, signed and never clamped: below zero, more was declared lost than received. */
  readonly liveCount: number;
};

/**
 * Recomputes the live count of a campaign from its journal. Corrections count in place of the
 * declarations they correct, and neither the order of arrival nor duplicates change the result.
 */
export const computeLiveCount = (events: readonly JournalEvent[], context: LiveCountContext): LiveCount => {
  let received = 0;
  let deaths = 0;
  let losses = 0;
  for (const { declaration, fact } of effectiveJournal(events)) {
    if (declaration.campaignId !== context.campaignId) {
      continue;
    }
    if (fact.type === 'Delivery' && context.placementOrderLines.includes(fact.orderLineId)) {
      received += fact.receivedQuantity;
    } else if (fact.type === 'Death') {
      deaths += fact.quantity;
    } else if (fact.type === 'Loss') {
      losses += fact.quantity;
    }
  }
  return { received, deaths, losses, liveCount: received - deaths - losses };
};
