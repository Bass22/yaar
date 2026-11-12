import { describe, expect, it } from 'vitest';
import { halvesOf, recordLeftovers, type LeftoverInput } from './leftovers';

// Spec: backlog X.1 — les restes se saisissent en sacs entiers et en demi-sac entamé ; cahier des
// charges « Les restes et le bilan » (décisions du 2026-11-12 : tout ce qui se commande sauf les
// poussins ; sacs entiers plus un demi au plus pour l'aliment et la litière, unités entières sinon).

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const DEMARRAGE = uuid(31);
const LITIERE = uuid(32);
const VACCIN = uuid(33);
const POUSSINS = uuid(34);

const reste = (fields: Partial<LeftoverInput> = {}): LeftoverInput => ({ costTypeId: DEMARRAGE, category: 'Feed', whole: 3, halfBag: true, ...fields });

describe('Les restes saisis à la clôture', () => {
  it('l’aliment se compte en sacs entiers et un demi-sac entamé : 3 sacs et demi valent 7 demis', () => {
    // Given 3 sacs pleins et un sac entamé
    const restes = recordLeftovers([reste()]);

    // Then 3 × 2 + 1 = 7 demis, compté en sacs
    expect(restes.ok && restes.value).toEqual([{ costTypeId: DEMARRAGE, unit: 'bag', whole: 3, halfBag: true }]);
    expect(restes.ok && halvesOf(restes.value[0]!)).toBe(7);
  });

  it('un demi-sac seul est un reste ; la litière se compte en sacs comme l’aliment', () => {
    const restes = recordLeftovers([reste({ whole: 0, halfBag: true }), reste({ costTypeId: LITIERE, category: 'Bedding', whole: 2, halfBag: false })]);

    expect(restes.ok && restes.value.map(halvesOf)).toEqual([1, 4]);
    expect(restes.ok && restes.value[1]?.unit).toBe('bag');
  });

  it('la santé se compte en unités entières, sans demi', () => {
    const restes = recordLeftovers([reste({ costTypeId: VACCIN, category: 'Health', whole: 4, halfBag: false })]);
    expect(restes.ok && restes.value).toEqual([{ costTypeId: VACCIN, unit: 'unit', whole: 4, halfBag: false }]);

    const demi = recordLeftovers([reste({ costTypeId: VACCIN, category: 'Health', whole: 4, halfBag: true })]);
    expect(demi.ok ? null : demi.error).toEqual({ kind: 'HalfOnlyForBags', costTypeId: VACCIN });
  });

  it('les poussins ne sont pas un reste', () => {
    const restes = recordLeftovers([reste({ costTypeId: POUSSINS, category: 'Chicks', whole: 1, halfBag: false })]);

    expect(restes.ok ? null : restes.error).toEqual({ kind: 'NotALeftover', costTypeId: POUSSINS });
  });

  it('aucun reste du tout est une réponse permise', () => {
    const restes = recordLeftovers([]);

    expect(restes.ok && restes.value).toEqual([]);
  });

  it('une ligne vide, ni sac ni demi, ne s’écrit pas : elle est refusée', () => {
    const restes = recordLeftovers([reste({ whole: 0, halfBag: false })]);

    expect(restes.ok ? null : restes.error).toEqual({ kind: 'EmptyLeftover', costTypeId: DEMARRAGE });
  });

  it.each([-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])('un nombre de sacs qui n’est pas un entier positif est refusé : %s', (whole) => {
    const restes = recordLeftovers([reste({ whole })]);

    expect(restes.ok ? null : restes.error).toEqual({ kind: 'InvalidQuantity', costTypeId: DEMARRAGE });
  });

  it('un type n’a qu’une ligne', () => {
    const restes = recordLeftovers([reste(), reste({ whole: 1 })]);

    expect(restes.ok ? null : restes.error).toEqual({ kind: 'DuplicateType', costTypeId: DEMARRAGE });
  });

  it('un type qui n’est pas un identifiant est refusé', () => {
    const restes = recordLeftovers([reste({ costTypeId: 'DEMARRAGE' })]);

    expect(restes.ok ? null : restes.error).toEqual({ kind: 'InvalidId', costTypeId: 'DEMARRAGE' });
  });

  it('le reste écrit est gelé', () => {
    const restes = recordLeftovers([reste()]);

    expect(restes.ok && Object.isFrozen(restes.value)).toBe(true);
    expect(restes.ok && Object.isFrozen(restes.value[0])).toBe(true);
  });
});
