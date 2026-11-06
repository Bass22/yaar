import { unwrap } from '@kit';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Quantity } from './quantity';
import { Weight, type Scale } from './weight';

// Spec: Cahier des charges — « Demande de pesée » (poids enregistré au gramme près, balance du
// site ; le pas de 50 g n'est qu'une aide à la saisie du cadran) ; CLAUDE.md §4 règle 7.
// Les refus à la compilation (`@ts-expect-error`) sont vérifiés par `npx nx typecheck domain`.

const uneBalanceDe5Kg = (): Scale => ({ capacityGrams: 5_000 });
const uneBalanceDe10Kg = (): Scale => ({ capacityGrams: 10_000 });

describe('Poids lu sur la balance', () => {
  it("un poids s'exprime en grammes entiers, au gramme près", () => {
    for (const grams of [1, 50, 1_843, 2_000]) {
      expect(Weight(grams, uneBalanceDe5Kg())).toEqual({ ok: true, value: grams });
    }
  });

  it("un poids lu entre deux graduations du cadran reste un poids : le pas de 50 g n'est qu'une aide à la saisie", () => {
    expect(Weight(1_840, uneBalanceDe5Kg())).toEqual({ ok: true, value: 1_840 });
  });

  it('une fraction de gramme est refusée', () => {
    for (const grams of [1_825.5, 0.5, Number.NaN]) {
      expect(Weight(grams, uneBalanceDe5Kg())).toEqual({ ok: false, error: { kind: 'InvalidWeight', grams } });
    }
  });

  it('un poids nul ou négatif est refusé', () => {
    for (const grams of [0, -50]) {
      expect(Weight(grams, uneBalanceDe5Kg())).toEqual({ ok: false, error: { kind: 'InvalidWeight', grams } });
    }
  });

  it("un poids hors de l'échelle de la balance du site est refusé", () => {
    // Given une balance graduée jusqu'à 5 kg
    const scale = uneBalanceDe5Kg();

    // Then 5 000 g se lit encore, 5 001 g ne se lit plus
    expect(Weight(5_000, scale).ok).toBe(true);
    expect(Weight(5_001, scale)).toEqual({
      ok: false,
      error: { kind: 'WeightOutOfScale', grams: 5_001, capacityGrams: 5_000 },
    });
  });

  it("le même poids se lit sur une balance plus grande", () => {
    expect(Weight(5_050, uneBalanceDe10Kg())).toEqual({ ok: true, value: 5_050 });
  });

  it("sans capacité connue pour la balance, aucun poids n'est accepté", () => {
    for (const capacityGrams of [Number.NaN, 0, -5_000]) {
      expect(Weight(1_850, { capacityGrams }).ok).toBe(false);
    }
  });

  it("pour toute valeur, un poids est accepté si et seulement si c'est un entier de grammes positif que la balance sait lire (property-based)", () => {
    const aReading = fc.oneof(
      fc.integer({ min: -20_000, max: 20_000 }),
      fc.double({ min: -20_000, max: 20_000, noNaN: true }),
    );

    fc.assert(
      fc.property(aReading, (grams) => {
        const readable = Number.isInteger(grams) && grams > 0 && grams <= 5_000;

        return Weight(grams, uneBalanceDe5Kg()).ok === readable;
      }),
    );
  });

  it("un poids et une quantité ne sont pas interchangeables", () => {
    // Given
    const weight = unwrap(Weight(1_850, uneBalanceDe5Kg()));
    const quantity = unwrap(Quantity(5));
    const record = (grams: Weight): number => grams;

    // Then
    expect(record(weight)).toBe(1_850);
    // @ts-expect-error cinq poulets ne sont pas cinq grammes
    record(quantity);
  });
});
