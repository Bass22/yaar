import { err, ok, type Brand, type Result } from '@kit';
import type { Refusal } from './refusal';

/** The scale of a site, as far as a reading is concerned: how far it goes. */
export type Scale = { readonly capacityGrams: number };

/**
 * A weight read on the scale of the site: whole grams, to the gram, above zero and within the
 * capacity of that scale. The step of the on-screen dial is an input aid, not a rule: a reading
 * taken from a photo or a digital scale falls between two graduations.
 */
export type Weight = Brand<number, 'Weight'>;

export const Weight = (grams: number, scale: Scale): Result<Weight, Refusal> => {
  if (!Number.isSafeInteger(grams) || grams <= 0) {
    return err({ kind: 'InvalidWeight', grams });
  }
  // Written so that an unknown capacity (NaN) refuses every reading.
  if (!(grams <= scale.capacityGrams)) {
    return err({ kind: 'WeightOutOfScale', grams, capacityGrams: scale.capacityGrams });
  }
  return ok(grams as Weight);
};
