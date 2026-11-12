import { effectiveJournal } from './counter-declaration';
import type { CampaignId, OrderLineId } from './ids';
import type { JournalEvent } from './journal-event';

export type LiveCountContext = {
  readonly campaignId: CampaignId;
  /** The order lines that deliver the animals placed in the campaign: the journal cannot tell them from feed. */
  readonly placementOrderLines: readonly OrderLineId[];
  /** Birds sold so far (W.1): they leave the flock without being losses. A number only — no amount. */
  readonly sold?: number;
};

export type LiveCount = {
  /** Animals actually received, bonus included: the ordered quantity plays no part. */
  readonly received: number;
  readonly deaths: number;
  /** Losses that are not deaths: missing, given away, stolen. They never count as mortality. */
  readonly losses: number;
  /** Birds sold: they left the flock (W.1). */
  readonly sold: number;
  /** `received − deaths − losses − sold`, signed and never clamped: below zero, more left than was received. */
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
    if (fact === null || declaration.campaignId !== context.campaignId) {
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
  const sold = context.sold ?? 0;
  return { received, deaths, losses, sold, liveCount: received - deaths - losses - sold };
};

/**
 * The mortality of a flock (V.3): deaths ÷ chicks received, to the thousandth. Losses that are not
 * deaths and birds sold play no part. `null` while no chick is received: absent, never zero.
 */
export const mortality = (count: LiveCount): number | null => (count.received > 0 ? Math.round((count.deaths / count.received) * 1000) / 1000 : null);
