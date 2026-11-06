import { describe, expect, it } from 'vitest';
import { err, ok, unwrap, type Result } from './result';

// Spec: CLAUDE.md §8 — erreurs métier typées (résultat typé), exceptions réservées aux pannes

type DivisionError = { readonly kind: 'DivisionByZero' };

const divide = (dividend: number, divisor: number): Result<number, DivisionError> =>
  divisor === 0 ? err({ kind: 'DivisionByZero' }) : ok(dividend / divisor);

describe('Résultat typé', () => {
  it('un succès porte sa valeur', () => {
    // When
    const result = divide(6, 3);

    // Then
    expect(result).toEqual({ ok: true, value: 2 });
  });

  it('un échec est une valeur qui porte son motif, pas une exception', () => {
    // When
    const attempt = (): Result<number, DivisionError> => divide(6, 0);

    // Then
    expect(attempt).not.toThrow();
    expect(attempt()).toEqual({ ok: false, error: { kind: 'DivisionByZero' } });
  });

  it("la valeur ne se lit qu'après avoir écarté l'échec", () => {
    // Given
    const result = divide(6, 3);

    // Then
    // @ts-expect-error la valeur n'existe pas tant que l'échec n'est pas écarté
    expect(result.value).toBe(2);
    if (result.ok) {
      expect(result.value).toBe(2);
    }
  });

  describe('unwrap — quand un échec serait un bug, pas un refus', () => {
    it("rend la valeur d'un succès", () => {
      expect(unwrap(divide(6, 3))).toBe(2);
    });

    it('lève une exception qui cite le motif', () => {
      expect(() => unwrap(divide(6, 0))).toThrow('unwrap on an error Result: {"kind":"DivisionByZero"}');
    });

    it("lève le message fourni par l'appelant", () => {
      // Given
      const describeError = (error: DivisionError): string => `fixture invalide : ${error.kind}`;

      // Then
      expect(() => unwrap(divide(6, 0), describeError)).toThrow('fixture invalide : DivisionByZero');
    });
  });
});
