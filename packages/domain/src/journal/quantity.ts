import { err, ok, type Brand, type Result } from '@kit';
import type { Refusal } from './refusal';

/**
 * A declared count of whole units (birds, bags): a strictly positive integer. The
 * caretaker never handles fractions, and zero is not a quantity — "nothing lost" is
 * declared by its own event, so that an absent value is never mistaken for zero.
 */
export type Quantity = Brand<number, 'Quantity'>;

export const Quantity = (value: number): Result<Quantity, Refusal> =>
  Number.isSafeInteger(value) && value >= 1 ? ok(value as Quantity) : err({ kind: 'InvalidQuantity', value });
