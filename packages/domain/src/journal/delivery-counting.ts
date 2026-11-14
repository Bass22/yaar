/** Chicks come in boxes of fifty: the caretaker counts the boxes (decision of 2026-11-11). */
export const CHICKS_PER_BOX = 50;

/** What the caretaker counts at a delivery: bags, boxes of animals, or the items themselves. */
export type CountingUnit = 'bag' | 'box' | 'unit';

export type DeliveryCounting = {
  readonly unit: CountingUnit;
  /** How many of the ordered quantity one counted unit holds. */
  readonly perUnit: number;
  /** What the counter starts from: what is still to come, in counted units, rounded up. */
  readonly expected: number;
};

/**
 * How a line is counted when it arrives (Q.7), from the category of what was ordered — a word of
 * the order, sent to the phone without any price: feed and bedding by the bag, the animals placed
 * by the box, the rest as they are.
 */
/** Feed and bedding come and leave by the bag (Q.7, X.1); everything else as it is. */
export const byTheBag = (category: string): boolean => category === 'Feed' || category === 'Bedding';

export function deliveryCounting(category: string, remaining: number): DeliveryCounting {
  if (category === 'Chicks') {
    return { unit: 'box', perUnit: CHICKS_PER_BOX, expected: Math.ceil(remaining / CHICKS_PER_BOX) };
  }
  return { unit: byTheBag(category) ? 'bag' : 'unit', perUnit: 1, expected: remaining };
}

/** What is written as received: the count times what one unit holds — 21 boxes, 1 050 chicks. */
export const receivedOf = (count: number, counting: DeliveryCounting): number => count * counting.perUnit;
