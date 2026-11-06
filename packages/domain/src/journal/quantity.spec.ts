import { unwrap } from '@kit';
import { describe, expect, it } from 'vitest';
import { Quantity } from './quantity';

// Spec: CLAUDE.md §4 règle 7 — quantités en unités entières ; règle 10 — zéro se déclare.
// Les refus à la compilation (`@ts-expect-error`) sont vérifiés par `npx nx typecheck domain`.

describe('Quantité déclarée', () => {
  it('une quantité déclarée est un entier strictement positif', () => {
    for (const count of [1, 3, 1_200]) {
      expect(Quantity(count)).toEqual({ ok: true, value: count });
    }
  });

  it("zéro n'est pas une quantité : il se déclare par un événement dédié", () => {
    expect(Quantity(0)).toEqual({ ok: false, error: { kind: 'InvalidQuantity', value: 0 } });
  });

  it('une quantité négative ou fractionnaire est refusée', () => {
    for (const value of [-1, 2.5, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(Quantity(value)).toEqual({ ok: false, error: { kind: 'InvalidQuantity', value } });
    }
  });

  it('une quantité trop grande pour rester un entier exact est refusée', () => {
    expect(Quantity(Number.MAX_SAFE_INTEGER + 1).ok).toBe(false);
  });

  it("ce qui n'est pas un nombre est refusé, même si le typage a été contourné", () => {
    for (const value of ['3', null, undefined, [3]]) {
      expect(Quantity(value as unknown as number).ok).toBe(false);
    }
  });

  it("un nombre non vérifié ne passe pas pour une quantité, mais une quantité se compte", () => {
    // Given
    const dead = unwrap(Quantity(3));
    const moreDead = unwrap(Quantity(2));
    const declare = (count: Quantity): number => count;

    // Then
    expect(declare(dead) + moreDead).toBe(5);
    // @ts-expect-error un nombre quelconque n'est pas une quantité vérifiée
    declare(3);
  });
});
