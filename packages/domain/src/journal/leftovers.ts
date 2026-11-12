import { err, ok, type Result } from '@kit';
import { deliveryCounting } from './delivery-counting';

/** What is left of one type at the closing (X.1): whole bags or units, and at most one half bag opened. */
export type Leftover = {
  readonly costTypeId: string;
  /** Feed and bedding by the bag; the rest by the unit. */
  readonly unit: 'bag' | 'unit';
  readonly whole: number;
  readonly halfBag: boolean;
};

export type LeftoverInput = {
  readonly costTypeId: string;
  /** The category of the type, a word of the order (`Feed`, `Bedding`, `Health`…). */
  readonly category: string;
  readonly whole: number;
  readonly halfBag?: boolean;
};

export type LeftoverRefusal =
  | { readonly kind: 'InvalidId'; readonly costTypeId: string }
  /** Animals are not a leftover. */
  | { readonly kind: 'NotALeftover'; readonly costTypeId: string }
  | { readonly kind: 'InvalidQuantity'; readonly costTypeId: string }
  | { readonly kind: 'HalfOnlyForBags'; readonly costTypeId: string }
  /** Neither a bag nor a half: such a line is not written. */
  | { readonly kind: 'EmptyLeftover'; readonly costTypeId: string }
  | { readonly kind: 'DuplicateType'; readonly costTypeId: string };

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The leftovers the admin enters at the closing (CdC « Les restes et le bilan », 2026-11-12):
 * everything orderable but the chicks; feed and bedding in whole bags plus one half bag opened at
 * most, the rest in whole units. One line a type; no leftover at all is an answer.
 */
export function recordLeftovers(inputs: readonly LeftoverInput[]): Result<readonly Leftover[], LeftoverRefusal> {
  const leftovers: Leftover[] = [];
  const seen = new Set<string>();
  for (const { costTypeId, category, whole, halfBag = false } of inputs) {
    if (!CANONICAL_UUID.test(costTypeId)) return err({ kind: 'InvalidId', costTypeId });
    const { unit } = deliveryCounting(category, 0);
    if (unit === 'box') return err({ kind: 'NotALeftover', costTypeId });
    if (!Number.isSafeInteger(whole) || whole < 0) return err({ kind: 'InvalidQuantity', costTypeId });
    if (halfBag && unit !== 'bag') return err({ kind: 'HalfOnlyForBags', costTypeId });
    if (whole === 0 && !halfBag) return err({ kind: 'EmptyLeftover', costTypeId });
    if (seen.has(costTypeId)) return err({ kind: 'DuplicateType', costTypeId });
    seen.add(costTypeId);
    leftovers.push(Object.freeze({ costTypeId, unit, whole, halfBag }));
  }
  return ok(Object.freeze(leftovers));
}

/** A leftover counted in halves, so that no fraction is ever stored: 3 bags and a half are 7. */
export const halvesOf = (leftover: Leftover): number => leftover.whole * 2 + (leftover.halfBag ? 1 : 0);
