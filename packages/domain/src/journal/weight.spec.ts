import { unwrap } from '@kit';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Quantity } from './quantity';
import { Weight } from './weight';

// Spec: Cahier des charges — « Demande de pesée » (poids enregistré au gramme près, tapé
// directement en grammes : la balance n'est pas modélisée, décision du 2026-11-07) ;
// CLAUDE.md §4 règle 7. Les refus à la compilation (`@ts-expect-error`) sont vérifiés par
// `npx nx typecheck domain`.

describe('Poids', () => {
  it("un poids s'exprime en grammes entiers, au gramme près, quel qu'il soit", () => {
    for (const grams of [1, 50, 1_843, 2_000, 12_500]) {
      expect(Weight(grams)).toEqual({ ok: true, value: grams });
    }
  });

  it('une fraction de gramme est refusée', () => {
    for (const grams of [1_825.5, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(Weight(grams)).toEqual({ ok: false, error: { kind: 'InvalidWeight', grams } });
    }
  });

  it('un poids nul ou négatif est refusé', () => {
    for (const grams of [0, -50]) {
      expect(Weight(grams)).toEqual({ ok: false, error: { kind: 'InvalidWeight', grams } });
    }
  });

  it("pour toute valeur, un poids est accepté si et seulement si c'est un entier de grammes positif (property-based)", () => {
    const aReading = fc.oneof(fc.integer({ min: -20_000, max: 20_000 }), fc.double({ min: -20_000, max: 20_000, noNaN: true }));

    fc.assert(fc.property(aReading, (grams) => Weight(grams).ok === (Number.isInteger(grams) && grams > 0)));
  });

  it("un poids et une quantité ne sont pas interchangeables", () => {
    // Given
    const weight = unwrap(Weight(1_850));
    const quantity = unwrap(Quantity(5));
    const record = (grams: Weight): number => grams;

    // Then
    expect(record(weight)).toBe(1_850);
    // @ts-expect-error cinq poulets ne sont pas cinq grammes
    record(quantity);
  });
});
