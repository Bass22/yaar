import { err, ok, type Result } from '../result';
import type { CurrencyCode } from './currency-code';
import type { MoneyError } from './money-error';

/**
 * A monetary amount, stored as an integer in the currency's smallest unit
 * plus an ISO 4217 currency code.
 *
 * Financial-correctness rules:
 *  - never a floating-point amount: the value is an exact integer (XOF has 0 decimals);
 *  - the currency is carried by the amount, never hard-coded in a calc;
 *  - an invalid amount is not representable: build only through `Money.of`.
 *
 * Operations across different currencies are rejected (no XOF + EUR).
 */
export class Money {
  private constructor(
    readonly amount: number,
    readonly currency: CurrencyCode,
  ) {}

  /** Smart constructor: rejects non-integer, negative and inexact (too large) amounts. */
  static of(amount: number, currency: CurrencyCode): Result<Money, MoneyError> {
    if (!Number.isInteger(amount)) {
      return err({ kind: 'NonIntegerAmount', amount, currency });
    }
    if (amount < 0) {
      return err({ kind: 'NegativeAmount', amount, currency });
    }
    if (!Number.isSafeInteger(amount)) {
      return err({ kind: 'AmountOutOfRange', currency });
    }
    return ok(new Money(amount, currency));
  }

  /** The neutral element for a currency — a defined Money, distinct from an absent value. */
  static zero(currency: CurrencyCode): Money {
    return new Money(0, currency);
  }

  add(other: Money): Result<Money, MoneyError> {
    if (this.currency !== other.currency) {
      return err({ kind: 'CurrencyMismatch', left: this.currency, right: other.currency });
    }
    return Money.of(this.amount + other.amount, this.currency);
  }

  subtract(other: Money): Result<Money, MoneyError> {
    if (this.currency !== other.currency) {
      return err({ kind: 'CurrencyMismatch', left: this.currency, right: other.currency });
    }
    const result = this.amount - other.amount;
    if (result < 0) {
      return err({ kind: 'NegativeResult', currency: this.currency });
    }
    return ok(new Money(result, this.currency));
  }

  /** Unit price × quantity: the multiplier is a whole, non-negative number. */
  times(multiplier: number): Result<Money, MoneyError> {
    if (!Number.isInteger(multiplier) || multiplier < 0) {
      return err({ kind: 'InvalidMultiplier', multiplier });
    }
    return Money.of(this.amount * multiplier, this.currency);
  }

  equals(other: Money): boolean {
    return this.amount === other.amount && this.currency === other.currency;
  }
}
