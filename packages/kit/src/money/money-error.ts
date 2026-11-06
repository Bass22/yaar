import type { CurrencyCode } from './currency-code';

/**
 * Closed list of the reasons an amount is refused. Each case carries the data needed to
 * explain the refusal — never a bare string.
 */
export type MoneyError =
  | { readonly kind: 'NonIntegerAmount'; readonly amount: number; readonly currency: CurrencyCode }
  | { readonly kind: 'NegativeAmount'; readonly amount: number; readonly currency: CurrencyCode }
  /** Beyond the largest integer a number holds exactly: refused rather than silently rounded. */
  | { readonly kind: 'AmountOutOfRange'; readonly currency: CurrencyCode }
  | { readonly kind: 'CurrencyMismatch'; readonly left: CurrencyCode; readonly right: CurrencyCode }
  | { readonly kind: 'NegativeResult'; readonly currency: CurrencyCode }
  /** An amount is multiplied by a whole, non-negative quantity only. */
  | { readonly kind: 'InvalidMultiplier'; readonly multiplier: number };
