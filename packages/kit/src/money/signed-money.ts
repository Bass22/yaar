import { err, ok, type Result } from '../result';
import type { CurrencyCode } from './currency-code';
import type { Money } from './money';
import type { MoneyError } from './money-error';

/**
 * A signed monetary value — the result of a difference that may be negative, such as a
 * balance or a margin. Subtraction below zero is rejected by `Money`; this is the
 * explicit signed path. Amounts stay in the non-negative `Money`; only computed
 * differences live here.
 */
export class SignedMoney {
  private constructor(
    readonly amount: number,
    readonly currency: CurrencyCode,
  ) {}

  static of(amount: number, currency: CurrencyCode): Result<SignedMoney, MoneyError> {
    if (!Number.isInteger(amount)) {
      return err({ kind: 'NonIntegerAmount', amount, currency });
    }
    if (!Number.isSafeInteger(amount)) {
      return err({ kind: 'AmountOutOfRange', currency });
    }
    return ok(new SignedMoney(amount, currency));
  }

  /** Lift a non-negative Money into the signed space. */
  static fromMoney(money: Money): SignedMoney {
    return new SignedMoney(money.amount, money.currency);
  }

  add(other: SignedMoney): Result<SignedMoney, MoneyError> {
    if (this.currency !== other.currency) {
      return err({ kind: 'CurrencyMismatch', left: this.currency, right: other.currency });
    }
    return SignedMoney.of(this.amount + other.amount, this.currency);
  }

  subtract(other: SignedMoney): Result<SignedMoney, MoneyError> {
    if (this.currency !== other.currency) {
      return err({ kind: 'CurrencyMismatch', left: this.currency, right: other.currency });
    }
    return SignedMoney.of(this.amount - other.amount, this.currency);
  }

  isNegative(): boolean {
    return this.amount < 0;
  }

  equals(other: SignedMoney): boolean {
    return this.amount === other.amount && this.currency === other.currency;
  }
}
