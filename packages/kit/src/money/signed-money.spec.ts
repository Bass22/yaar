import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { unwrap } from '../result';
import { Money } from './money';
import { SignedMoney } from './signed-money';

// Spec: CLAUDE.md §4 règles 7 et 9 — un montant n'est jamais négatif ; une différence, elle,
// est signée et jamais bridée.

const fcfa = (amount: number): Money => unwrap(Money.of(amount, 'XOF'));
const signedFcfa = (amount: number): SignedMoney => unwrap(SignedMoney.of(amount, 'XOF'));
const signed = (money: Money): SignedMoney => SignedMoney.fromMoney(money);

describe('SignedMoney — une différence de montants, qui peut être négative', () => {
  it('une différence négative vit dans SignedMoney', () => {
    // Given 10 000 FCFA d'un côté, 40 000 FCFA de l'autre
    const left = fcfa(10_000);
    const right = fcfa(40_000);

    // When
    const difference = unwrap(signed(left).subtract(signed(right)));

    // Then 10 000 − 40 000 = −30 000
    expect(difference.amount).toBe(-30_000);
    expect(difference.currency).toBe('XOF');
    expect(difference.isNegative()).toBe(true);
  });

  it("une différence positive ou nulle n'est pas négative", () => {
    expect(unwrap(signed(fcfa(40_000)).subtract(signed(fcfa(10_000)))).isNegative()).toBe(false);
    expect(unwrap(signed(fcfa(500)).subtract(signed(fcfa(500)))).isNegative()).toBe(false);
  });

  it('un montant garde sa valeur et sa devise en devenant une différence', () => {
    expect(signed(fcfa(7_500)).equals(signedFcfa(7_500))).toBe(true);
  });

  it('une fraction de franc est refusée', () => {
    expect(SignedMoney.of(-10.5, 'XOF')).toEqual({
      ok: false,
      error: { kind: 'NonIntegerAmount', amount: -10.5, currency: 'XOF' },
    });
  });

  it('une valeur trop grande pour rester un entier exact est refusée, dans les deux sens', () => {
    for (const amount of [Number.MAX_SAFE_INTEGER + 1, Number.MIN_SAFE_INTEGER - 1]) {
      expect(SignedMoney.of(amount, 'XOF')).toEqual({
        ok: false,
        error: { kind: 'AmountOutOfRange', currency: 'XOF' },
      });
    }
    expect(signedFcfa(Number.MIN_SAFE_INTEGER).subtract(signedFcfa(1))).toEqual({
      ok: false,
      error: { kind: 'AmountOutOfRange', currency: 'XOF' },
    });
  });

  it("deux différences de même devise s'additionnent", () => {
    expect(unwrap(signedFcfa(-30_000).add(signedFcfa(10_000))).equals(signedFcfa(-20_000))).toBe(true);
  });

  it("deux devises différentes ne s'additionnent ni ne se soustraient", () => {
    // Given
    const euros = unwrap(SignedMoney.of(1_000, 'EUR'));
    const mismatch = { ok: false, error: { kind: 'CurrencyMismatch', left: 'XOF', right: 'EUR' } };

    // Then
    expect(signedFcfa(1_000).add(euros)).toEqual(mismatch);
    expect(signedFcfa(1_000).subtract(euros)).toEqual(mismatch);
  });

  it('deux différences sont égales quand la valeur et la devise le sont', () => {
    expect(signedFcfa(-500).equals(signedFcfa(-500))).toBe(true);
    expect(signedFcfa(-500).equals(signedFcfa(500))).toBe(false);
    expect(signedFcfa(-500).equals(unwrap(SignedMoney.of(-500, 'EUR')))).toBe(false);
  });

  it('pour toutes différences a et b, (a − b) + b = a (property-based)', () => {
    const aDifference = fc.integer({ min: -1_000_000_000, max: 1_000_000_000 });

    fc.assert(
      fc.property(aDifference, aDifference, (rawA, rawB) => {
        const a = signedFcfa(rawA);
        const b = signedFcfa(rawB);

        const back = unwrap(unwrap(a.subtract(b)).add(b));

        return back.equals(a);
      }),
    );
  });
});
