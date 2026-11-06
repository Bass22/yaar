import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { unwrap } from '../result';
import { Money } from './money';

// Spec: CLAUDE.md §4 règle 7 — jamais de flottant pour l'argent : un entier dans la plus
// petite unité de la devise, et la devise portée par le montant.

const fcfa = (amount: number): Money => unwrap(Money.of(amount, 'XOF'));
const euroCents = (amount: number): Money => unwrap(Money.of(amount, 'EUR'));

const LARGEST_EXACT = Number.MAX_SAFE_INTEGER;

describe("Money — un montant qui ne connaît pas l'erreur d'arrondi", () => {
  describe('Construction', () => {
    it('un montant entier en FCFA est valide', () => {
      // When
      const result = Money.of(100_000, 'XOF');

      // Then
      expect(result.ok).toBe(true);
      expect(unwrap(result).amount).toBe(100_000);
      expect(unwrap(result).currency).toBe('XOF');
    });

    it('une fraction de franc est refusée', () => {
      for (const amount of [10.5, 0.1 + 0.2, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(Money.of(amount, 'XOF')).toEqual({
          ok: false,
          error: { kind: 'NonIntegerAmount', amount, currency: 'XOF' },
        });
      }
    });

    it('un montant négatif est refusé', () => {
      expect(Money.of(-1, 'XOF')).toEqual({
        ok: false,
        error: { kind: 'NegativeAmount', amount: -1, currency: 'XOF' },
      });
    });

    it('un montant trop grand pour rester un entier exact est refusé', () => {
      expect(Money.of(LARGEST_EXACT, 'XOF').ok).toBe(true);
      expect(Money.of(LARGEST_EXACT + 1, 'XOF')).toEqual({
        ok: false,
        error: { kind: 'AmountOutOfRange', currency: 'XOF' },
      });
    });
  });

  describe('Montant nul et montant absent', () => {
    it('un montant nul est un montant défini, égal à un zéro construit', () => {
      // When
      const zero = Money.zero('XOF');

      // Then
      expect(zero.amount).toBe(0);
      expect(zero.equals(fcfa(0))).toBe(true);
    });

    it("un montant nul est distinct d'un montant absent", () => {
      // Given
      const absent: Money | undefined = undefined;

      // Then
      expect(Money.zero('XOF')).not.toEqual(absent);
    });
  });

  describe('Égalité', () => {
    it('deux montants sont égaux quand le montant et la devise le sont', () => {
      expect(fcfa(500).equals(fcfa(500))).toBe(true);
      expect(fcfa(500).equals(fcfa(501))).toBe(false);
      expect(fcfa(500).equals(euroCents(500))).toBe(false);
    });
  });

  describe('Addition', () => {
    it("deux montants de même devise s'additionnent", () => {
      // When
      const sum = fcfa(40_000).add(fcfa(10_000));

      // Then
      expect(unwrap(sum).equals(fcfa(50_000))).toBe(true);
    });

    it("deux devises différentes ne s'additionnent pas", () => {
      expect(fcfa(1_000).add(euroCents(1_000))).toEqual({
        ok: false,
        error: { kind: 'CurrencyMismatch', left: 'XOF', right: 'EUR' },
      });
    });

    it("une somme qui dépasse l'entier exact est refusée, jamais arrondie", () => {
      expect(fcfa(LARGEST_EXACT).add(fcfa(1))).toEqual({
        ok: false,
        error: { kind: 'AmountOutOfRange', currency: 'XOF' },
      });
    });
  });

  describe('Soustraction', () => {
    it('deux montants de même devise se soustraient', () => {
      expect(unwrap(fcfa(40_000).subtract(fcfa(10_000))).equals(fcfa(30_000))).toBe(true);
    });

    it('une soustraction qui passerait sous zéro est refusée', () => {
      expect(fcfa(10_000).subtract(fcfa(40_000))).toEqual({
        ok: false,
        error: { kind: 'NegativeResult', currency: 'XOF' },
      });
    });

    it('deux devises différentes ne se soustraient pas', () => {
      expect(fcfa(1_000).subtract(euroCents(1_000))).toEqual({
        ok: false,
        error: { kind: 'CurrencyMismatch', left: 'XOF', right: 'EUR' },
      });
    });
  });

  describe('Multiplication par une quantité', () => {
    it('un montant multiplié par une quantité entière reste un entier exact', () => {
      // Given 1 200 poussins à 350 FCFA
      const unitPrice = fcfa(350);

      // When
      const total = unitPrice.times(1_200);

      // Then 350 × 1 200 = 420 000
      expect(unwrap(total).equals(fcfa(420_000))).toBe(true);
    });

    it('multiplié par zéro, un montant devient le montant nul de sa devise', () => {
      expect(unwrap(fcfa(350).times(0)).equals(Money.zero('XOF'))).toBe(true);
    });

    it('une quantité fractionnaire ou négative est refusée', () => {
      for (const multiplier of [2.5, -1, Number.NaN]) {
        expect(fcfa(350).times(multiplier)).toEqual({
          ok: false,
          error: { kind: 'InvalidMultiplier', multiplier },
        });
      }
    });

    it("un produit qui dépasse l'entier exact est refusé, jamais arrondi", () => {
      expect(fcfa(LARGEST_EXACT).times(2)).toEqual({
        ok: false,
        error: { kind: 'AmountOutOfRange', currency: 'XOF' },
      });
    });
  });

  describe('Invariants (property-based)', () => {
    const anAmount = fc.integer({ min: 0, max: 1_000_000_000 });
    const aQuantity = fc.integer({ min: 0, max: 1_000_000 });

    it('pour tous montants a et b, (a + b) − b = a', () => {
      fc.assert(
        fc.property(anAmount, anAmount, (rawA, rawB) => {
          const a = fcfa(rawA);
          const b = fcfa(rawB);

          const back = unwrap(unwrap(a.add(b)).subtract(b));

          return back.equals(a);
        }),
      );
    });

    it("pour tout montant et toute quantité entière, le produit est l'entier exact", () => {
      fc.assert(
        fc.property(anAmount, aQuantity, (rawAmount, quantity) => {
          const product = unwrap(fcfa(rawAmount).times(quantity));

          return BigInt(product.amount) === BigInt(rawAmount) * BigInt(quantity);
        }),
      );
    });
  });
});
