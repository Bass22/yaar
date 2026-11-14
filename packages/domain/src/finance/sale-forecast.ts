import { err, Money, ok, SignedMoney, type CurrencyCode, type Result } from '@kit';
import { BusinessDay } from '../journal/business-day';
import { isCanonicalUuid } from '../journal/ids';


/**
 * A sale planned for a flock (W.4; decisions of 2026-11-13): a buyer, a week, a number of birds at
 * a price per bird — the only price that counts for now. The average weight is told for
 * information: it changes no figure. A plan, never a receivable.
 */
export type SaleForecast = {
  /** The planned sale, the same through its revisions: the last written prevails. */
  readonly forecastId: string;
  readonly buyerId: string;
  /** A day of the week planned, `YYYY-MM-DD`. */
  readonly week: BusinessDay;
  readonly birds: number;
  /** By the bird, or by the kilo (demand of 2026-11-13). */
  readonly pricing: { readonly kind: 'PerBird'; readonly price: Money } | { readonly kind: 'PerKilo'; readonly price: Money };
  /** Grams. By the bird, for information only, `null` when not told; by the kilo, always told: it makes the revenue. */
  readonly averageWeight: number | null;
};

export type SaleForecastInput = {
  readonly forecastId: string;
  readonly buyerId: string;
  readonly week: string;
  readonly birds: number;
  readonly pricing: { readonly kind: 'PerBird' | 'PerKilo'; readonly price: number };
  readonly averageWeight: number | null;
};

export type SaleForecastRefusal =
  | { readonly kind: 'InvalidId' }
  | { readonly kind: 'UnknownBuyer' }
  | { readonly kind: 'InvalidBusinessDay' }
  | { readonly kind: 'WeekBeforePlacement' }
  | { readonly kind: 'InvalidBirds' }
  | { readonly kind: 'InvalidPrice' }
  | { readonly kind: 'InvalidWeight' }
  /** By the kilo, the weight makes the revenue: it must be told. */
  | { readonly kind: 'MissingWeight' };

export type SaleForecastContext = {
  readonly currency: CurrencyCode;
  readonly placementDay: string;
  readonly buyers: readonly { readonly id: string; readonly kind: 'Supplier' | 'Customer' | 'Collaborator'; readonly archived: boolean }[];
};

export function recordSaleForecast(input: SaleForecastInput, context: SaleForecastContext): Result<SaleForecast, SaleForecastRefusal> {
  if (!isCanonicalUuid(input.forecastId)) return err({ kind: 'InvalidId' });
  const buyer = context.buyers.find(({ id }) => id === input.buyerId);
  if (buyer === undefined || buyer.kind !== 'Customer' || buyer.archived) return err({ kind: 'UnknownBuyer' });
  const week = BusinessDay(input.week);
  if (!week.ok) return err({ kind: 'InvalidBusinessDay' });
  if (week.value < context.placementDay) return err({ kind: 'WeekBeforePlacement' });
  if (!Number.isSafeInteger(input.birds) || input.birds < 1) return err({ kind: 'InvalidBirds' });
  const price = Money.of(input.pricing.price, context.currency);
  if (!price.ok || (input.pricing.kind !== 'PerBird' && input.pricing.kind !== 'PerKilo')) return err({ kind: 'InvalidPrice' });
  if (input.averageWeight !== null && (!Number.isSafeInteger(input.averageWeight) || input.averageWeight <= 0)) return err({ kind: 'InvalidWeight' });
  if (input.pricing.kind === 'PerKilo' && input.averageWeight === null) return err({ kind: 'MissingWeight' });
  return ok(Object.freeze({ forecastId: input.forecastId, buyerId: input.buyerId, week: week.value, birds: input.birds, pricing: Object.freeze({ kind: input.pricing.kind, price: price.value }), averageWeight: input.averageWeight }));
}

export type ForecastSummary = {
  /** Every planned sale: birds × price per bird, or birds × average weight × price per kilo, to the franc. */
  readonly expectedRevenue: Money;
  /** Expected revenue − budget, signed; `null` without a budget — never zero. */
  readonly expectedMargin: SignedMoney | null;
  /** The revenue of the sales made, read beside the plan. */
  readonly realized: Money;
};

/** The plan of a flock's sales against its budget, and what was really sold (W.4). */
export function forecastSummary(forecasts: readonly SaleForecast[], budget: Money | null, realized: Money): ForecastSummary {
  const amount = forecasts.reduce((sum, forecast) => sum + expectedOf(forecast), 0);
  const expectedRevenue = Money.of(amount, realized.currency);
  const revenue = expectedRevenue.ok ? expectedRevenue.value : Money.zero(realized.currency);
  const margin = budget === null ? null : SignedMoney.fromMoney(revenue).subtract(SignedMoney.fromMoney(budget));
  return { expectedRevenue: revenue, expectedMargin: margin === null || !margin.ok ? null : margin.value, realized };
}

/** The revenue a planned sale brings: by the bird, or by the kilo at its average weight, rounded to the franc. */
export const expectedOf = ({ birds, pricing, averageWeight }: SaleForecast): number =>
  pricing.kind === 'PerBird' ? birds * pricing.price.amount : Math.round((birds * (averageWeight ?? 0) * pricing.price.amount) / 1000);
