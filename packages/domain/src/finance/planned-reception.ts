import { err, ok, type Result } from '@kit';
import { BusinessDay } from '../journal/business-day';
import { acceptsDeliveries, type PurchaseOrder } from './purchase-order';
import { isCanonicalUuid } from '../journal/ids';


/**
 * A reception planned on an order received in several times (Q.14; decisions of 2026-11-13): its
 * date, and one or more lines of the order with what should come of each. The order keeps its own day.
 */
export type PlannedReception = {
  /** The planned reception, the same through its writings — a new date reschedules it. */
  readonly receptionId: string;
  readonly orderId: string;
  readonly plannedOn: BusinessDay;
  readonly lines: readonly { readonly orderLineId: string; readonly quantity: number }[];
};

export type PlannedReceptionInput = {
  readonly receptionId: string;
  readonly plannedOn: string;
  readonly lines: readonly { readonly orderLineId: string; readonly quantity: number }[];
};

export type PlannedReceptionRefusal =
  | { readonly kind: 'InvalidId' }
  | { readonly kind: 'InvalidBusinessDay' }
  | { readonly kind: 'BeforeOrderDay' }
  | { readonly kind: 'NoLines' }
  | { readonly kind: 'UnknownOrderLine' }
  | { readonly kind: 'InvalidQuantity' }
  | { readonly kind: 'DuplicateLine' }
  | { readonly kind: 'OrderNotReceiving' };

export function planReception(input: PlannedReceptionInput, order: PurchaseOrder): Result<PlannedReception, PlannedReceptionRefusal> {
  if (!isCanonicalUuid(input.receptionId)) return err({ kind: 'InvalidId' });
  // A draft accepts one: declaring receptions is how it is announced (Q.15). A closed order waits for nothing.
  if (order.closedAt !== null || (order.announcedAt !== null && !acceptsDeliveries(order).ok)) return err({ kind: 'OrderNotReceiving' });
  const plannedOn = BusinessDay(input.plannedOn);
  if (!plannedOn.ok) return err({ kind: 'InvalidBusinessDay' });
  if (plannedOn.value < order.orderDay) return err({ kind: 'BeforeOrderDay' });
  if (input.lines.length === 0) return err({ kind: 'NoLines' });
  const seen = new Set<string>();
  for (const { orderLineId, quantity } of input.lines) {
    if (!order.lines.some((line) => line.id === orderLineId)) return err({ kind: 'UnknownOrderLine' });
    if (!Number.isSafeInteger(quantity) || quantity < 1) return err({ kind: 'InvalidQuantity' });
    if (seen.has(orderLineId)) return err({ kind: 'DuplicateLine' });
    seen.add(orderLineId);
  }
  return ok(Object.freeze({ receptionId: input.receptionId, orderId: order.id, plannedOn: plannedOn.value, lines: Object.freeze(input.lines.map(({ orderLineId, quantity }) => Object.freeze({ orderLineId, quantity }))) }));
}

/** Where a planned reception stands: all received, late (its day passed), due today, or coming. */
export type ReceptionState = 'Received' | 'Late' | 'Today' | 'Coming';

export type ReceptionProgress = {
  readonly receptionId: string;
  readonly plannedOn: BusinessDay;
  readonly state: ReceptionState;
  readonly lines: readonly { readonly orderLineId: string; readonly expected: number; readonly received: number; readonly remaining: number }[];
};

/**
 * What was really received, line by line, fills the planned receptions in the order of their days
 * (Q.14): 12 bags received make the first reception of 10, and 2 of the next. A bonus never makes a
 * negative remainder. A reception whose day passed with something still to come is late.
 */
export function receptionProgress(planned: readonly PlannedReception[], received: ReadonlyMap<string, number>, today: string): ReceptionProgress[] {
  const left = new Map(received);
  return [...planned]
    .sort((a, b) => (a.plannedOn !== b.plannedOn ? (a.plannedOn < b.plannedOn ? -1 : 1) : a.receptionId < b.receptionId ? -1 : a.receptionId > b.receptionId ? 1 : 0))
    .map(({ receptionId, plannedOn, lines }) => {
      const progress = lines.map(({ orderLineId, quantity }) => {
        const available = left.get(orderLineId) ?? 0;
        const taken = Math.min(available, quantity);
        left.set(orderLineId, available - taken);
        return { orderLineId, expected: quantity, received: taken, remaining: quantity - taken };
      });
      const done = progress.every(({ remaining }) => remaining === 0);
      const state: ReceptionState = done ? 'Received' : plannedOn < today ? 'Late' : plannedOn === today ? 'Today' : 'Coming';
      return { receptionId, plannedOn, state, lines: progress };
    });
}

/**
 * What the caretaker waits for from an order received in several times (Q.15; founder's decisions
 * of 2026-11-14): the receptions due — today or late —, never the order whole, nothing before their
 * day. Line by line, what they expect, what came and what is left; the receptions due for the same
 * line add up, and a line all received is no longer waited for.
 */
export function dueReceptionLines(progress: readonly ReceptionProgress[]): { readonly orderLineId: string; readonly expected: number; readonly received: number; readonly remaining: number }[] {
  const due = new Map<string, { orderLineId: string; expected: number; received: number; remaining: number }>();
  for (const reception of progress) {
    if (reception.state !== 'Today' && reception.state !== 'Late') continue;
    for (const line of reception.lines) {
      const sum = due.get(line.orderLineId) ?? { orderLineId: line.orderLineId, expected: 0, received: 0, remaining: 0 };
      due.set(line.orderLineId, { orderLineId: line.orderLineId, expected: sum.expected + line.expected, received: sum.received + line.received, remaining: sum.remaining + line.remaining });
    }
  }
  return [...due.values()].filter(({ remaining }) => remaining > 0);
}
