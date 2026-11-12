import { err, Money, ok, SignedMoney, type CurrencyCode, type Result } from '@kit';
import { COST_CATEGORIES, type CostCategory } from './cost-category';

/** A line of a campaign's budget (S.1): a category and its plan; absent — never zero — without one. */
export type BudgetLine = { readonly category: CostCategory; readonly amount: Money | null };

export type BudgetLineInput = { readonly category: string; readonly amount: number | null };

export type BudgetRefusal =
  | { readonly kind: 'UnknownCategory'; readonly category: string }
  | { readonly kind: 'InvalidAmount'; readonly category: string }
  | { readonly kind: 'DuplicateCategory'; readonly category: string };

/**
 * A budget written for a campaign (CdC « Budget de campagne », decisions of 2026-11-12): a line a
 * category of the base, in whole units, zero allowed, or none. A plan: it is never a debt, and it
 * changes neither the committed cost nor any balance.
 */
export function recordBudget(inputs: readonly BudgetLineInput[], currency: CurrencyCode): Result<readonly BudgetLine[], BudgetRefusal> {
  const lines: BudgetLine[] = [];
  const seen = new Set<string>();
  for (const { category, amount } of inputs) {
    if (!COST_CATEGORIES.some((entry) => entry.category === category)) return err({ kind: 'UnknownCategory', category });
    if (seen.has(category)) return err({ kind: 'DuplicateCategory', category });
    seen.add(category);
    if (amount === null) {
      lines.push(Object.freeze({ category: category as CostCategory, amount: null }));
      continue;
    }
    const money = Money.of(amount, currency);
    if (!money.ok) return err({ kind: 'InvalidAmount', category });
    lines.push(Object.freeze({ category: category as CostCategory, amount: money.value }));
  }
  return ok(Object.freeze(lines));
}

/** What a closed campaign cost, category by category — net of the leftovers it passed on —, and its chicks received. */
export type ClosedCampaignCosts = { readonly chicksReceived: number; readonly byCategory: ReadonlyMap<CostCategory, SignedMoney> };

/**
 * The budget proposed from the history (decision of 2026-11-12): for each category, the median of
 * the cost per chick received of the closed campaigns × the planned headcount, rounded once, to
 * the nearest unit. A campaign without a chick received does not count; one that spent nothing on
 * a category counts for zero. Nothing is proposed without history, nor where the median is zero.
 */
export function suggestedBudget(history: readonly ClosedCampaignCosts[], plannedHeadcount: number, currency: CurrencyCode): Map<CostCategory, Money> {
  const counted = history.filter(({ chicksReceived }) => chicksReceived > 0);
  const suggested = new Map<CostCategory, Money>();
  if (counted.length === 0) return suggested;
  for (const { category } of COST_CATEGORIES) {
    const perChick = counted.map(({ chicksReceived, byCategory }) => (byCategory.get(category)?.amount ?? 0) / chicksReceived).sort((a, b) => a - b);
    const middle = Math.floor(perChick.length / 2);
    const median = perChick.length % 2 === 1 ? perChick[middle]! : (perChick[middle - 1]! + perChick[middle]!) / 2;
    const amount = Math.round(median * plannedHeadcount);
    if (amount <= 0) continue;
    const money = Money.of(amount, currency);
    if (money.ok) suggested.set(category, money.value);
  }
  return suggested;
}

/** The committed cost of a campaign, category by category. */
export function committedByCategory(items: readonly { readonly category: CostCategory; readonly amount: Money }[], currency: CurrencyCode): Map<CostCategory, Money> {
  const committed = new Map<CostCategory, Money>();
  for (const { category, amount } of items) {
    const sum = (committed.get(category) ?? Money.zero(currency)).add(amount);
    if (!sum.ok) throw new RangeError('The committed cost cannot be added up in one currency.');
    committed.set(category, sum.value);
  }
  return committed;
}

/** `budget − committed`, signed: below zero the category goes beyond its budget. No budget, no variance. */
export function budgetVariance(budget: Money | null, committed: Money): SignedMoney | null {
  if (budget === null) return null;
  const variance = SignedMoney.fromMoney(budget).subtract(SignedMoney.fromMoney(committed));
  if (!variance.ok) throw new RangeError('A budget and its committed cost in two currencies.');
  return variance.value;
}
