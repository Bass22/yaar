import { effectiveJournal } from './counter-declaration';
import type { OrderLineId } from './ids';
import type { JournalEvent } from './journal-event';
import type { Quantity } from './quantity';

/**
 * What each order line received, summed over the journal as it stands: a corrected delivery
 * counts for its new value, a retracted one no more. Neither the order of arrival nor
 * duplicates change it. A line that received nothing is absent, not zero. Quantities only:
 * this runs on the caretaker's phone.
 */
export const receivedByLine = (events: readonly JournalEvent[]): ReadonlyMap<OrderLineId, number> => {
  const received = new Map<OrderLineId, number>();
  for (const { fact } of effectiveJournal(events)) {
    if (fact?.type === 'Delivery') {
      received.set(fact.orderLineId, (received.get(fact.orderLineId) ?? 0) + fact.receivedQuantity);
    }
  }
  return received;
};

/** Where an order line stands: what is still to come, and the signed variance (shortfall below zero, bonus above). */
export type LineDelivery = {
  readonly ordered: number;
  readonly received: number;
  /** Never below zero: a bonus leaves nothing to come. */
  readonly remaining: number;
  /** `received − ordered`, never clamped. */
  readonly variance: number;
  readonly complete: boolean;
};

export const lineDelivery = (ordered: Quantity, received: number): LineDelivery => {
  const remaining = Math.max(0, ordered - received);
  return { ordered, received, remaining, variance: received - ordered, complete: remaining === 0 };
};
