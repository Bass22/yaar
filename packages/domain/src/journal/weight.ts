import { err, ok, type Brand, type Result } from '@kit';
import type { Refusal } from './refusal';

/**
 * A weight in whole grams, above zero, typed as read. The scale is not modelled (decision of
 * 2026-11-07): the caretaker types the weight directly, and no capacity bounds it.
 */
export type Weight = Brand<number, 'Weight'>;

export const Weight = (grams: number): Result<Weight, Refusal> =>
  Number.isSafeInteger(grams) && grams > 0 ? ok(grams as Weight) : err({ kind: 'InvalidWeight', grams });
