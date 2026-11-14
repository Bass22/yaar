import { err, ok, type Result } from '@kit';
import { deliveryCounting } from './delivery-counting';
import { isCanonicalUuid } from './ids';

/** What is left of one type at the closing (X.1): whole bags or units, and at most one opened, counted for half. */
export type Leftover = {
  readonly costTypeId: string;
  /** Feed and bedding by the bag; the rest by the unit. */
  readonly unit: 'bag' | 'unit';
  readonly whole: number;
  /** One bag, pot or bottle opened and not finished: it counts for half (decision of 2026-11-12). */
  readonly opened: boolean;
  /** The grams left in the opened bag of feed, when known (N.8d); `null`: half the bag. */
  readonly openedWeight: number | null;
};

export type LeftoverInput = {
  readonly costTypeId: string;
  /** The category of the type, a word of the order (`Feed`, `Bedding`, `Health`…). */
  readonly category: string;
  readonly whole: number;
  readonly opened?: boolean;
  readonly openedWeight?: number | null;
};

export type LeftoverRefusal =
  | { readonly kind: 'InvalidId'; readonly costTypeId: string }
  /** Animals are not a leftover. */
  | { readonly kind: 'NotALeftover'; readonly costTypeId: string }
  | { readonly kind: 'InvalidQuantity'; readonly costTypeId: string }
  /** Neither a whole one nor an opened one: such a line is not written. */
  | { readonly kind: 'EmptyLeftover'; readonly costTypeId: string }
  | { readonly kind: 'DuplicateType'; readonly costTypeId: string }
  /** A weight only for an opened bag of feed, in whole grams above zero (N.8d). */
  | { readonly kind: 'InvalidOpenedWeight'; readonly costTypeId: string };


/**
 * The leftovers the admin enters at the closing (CdC « Les restes et le bilan », 2026-11-12):
 * everything orderable but the chicks; feed and bedding in whole bags, the rest in whole units, and
 * for any type one opened at most, counted for half. One line a type; no leftover at all is an answer.
 */
export function recordLeftovers(inputs: readonly LeftoverInput[]): Result<readonly Leftover[], LeftoverRefusal> {
  const leftovers: Leftover[] = [];
  const seen = new Set<string>();
  for (const { costTypeId, category, whole, opened = false, openedWeight = null } of inputs) {
    if (!isCanonicalUuid(costTypeId)) return err({ kind: 'InvalidId', costTypeId });
    const { unit } = deliveryCounting(category, 0);
    if (unit === 'box') return err({ kind: 'NotALeftover', costTypeId });
    if (!Number.isSafeInteger(whole) || whole < 0) return err({ kind: 'InvalidQuantity', costTypeId });
    if (whole === 0 && !opened) return err({ kind: 'EmptyLeftover', costTypeId });
    if (openedWeight !== null && (!opened || category !== 'Feed' || !Number.isSafeInteger(openedWeight) || openedWeight <= 0)) return err({ kind: 'InvalidOpenedWeight', costTypeId });
    if (seen.has(costTypeId)) return err({ kind: 'DuplicateType', costTypeId });
    seen.add(costTypeId);
    leftovers.push(Object.freeze({ costTypeId, unit, whole, opened, openedWeight }));
  }
  return ok(Object.freeze(leftovers));
}

/** A leftover counted in halves, so that no fraction is ever stored: 3 bags and a half are 7. */
export const halvesOf = (leftover: Leftover): number => leftover.whole * 2 + (leftover.opened ? 1 : 0);

export type FeedCount = { readonly counted: number; readonly expected: number; readonly comment: string | null };
export type UnexplainedFeedGap = { readonly kind: 'UnexplainedFeedGap'; readonly expected: number; readonly counted: number; readonly gap: number };

/**
 * The bags of feed counted at the closing against those expected (N.8d, decisions of 2026-11-13):
 * all feeds together. A gap, either way, is explained by a comment — or the journal is corrected
 * first; the admin's count prevails. The gap is signed: fewer bags than expected is negative.
 */
export function checkFeedCount({ counted, expected, comment }: FeedCount): Result<{ readonly gap: number; readonly comment: string | null }, UnexplainedFeedGap> {
  const gap = counted - expected;
  const said = comment?.trim() ?? '';
  if (gap !== 0 && said === '') return err({ kind: 'UnexplainedFeedGap', expected, counted, gap });
  return ok({ gap, comment: gap === 0 ? null : said });
}
