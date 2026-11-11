import { err, ok, type Result } from '@kit';
import type { CampaignId } from './ids';
import type { Refusal } from './refusal';

/** The order line a delivery names, as ingestion reads it: its campaign and its order's state. Never a price. */
export type DeliveryTarget = {
  readonly campaignId: CampaignId;
  readonly announced: boolean;
  readonly closed: boolean;
};

/**
 * A delivery is received on a line of an order announced and not closed, of the campaign it is
 * written in (Q.1, Q.7). `null`: the line is unknown to the farm.
 */
export function validateDeliveryTarget(campaignId: CampaignId, line: DeliveryTarget | null): Result<void, Refusal> {
  if (line === null || line.campaignId !== campaignId) return err({ kind: 'UnknownOrderLine' });
  if (!line.announced || line.closed) return err({ kind: 'OrderNotReceiving' });
  return ok(undefined);
}
