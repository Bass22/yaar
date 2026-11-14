import { describe, expect, it } from 'vitest';
import { byTheBag, CHICKS_PER_BOX, deliveryCounting, receivedOf } from './delivery-counting';

// Spec: backlog Q.7 — le gardien compte la livraison ; cahier des charges « Livraison annoncée »
// (décisions du 2026-11-11 : les poussins se comptent en cartons de 50, le reçu vaut cartons × 50 ;
// le compteur est pré-rempli avec ce qui reste à venir). Des quantités seules : ce code va sur le
// téléphone du gardien.

describe('Ce que le gardien compte à la réception', () => {
  it('l’aliment et la litière se comptent en sacs, un sac pour un : le compteur part de ce qui reste', () => {
    expect([deliveryCounting('Feed', 12), deliveryCounting('Bedding', 30)]).toEqual([
      { unit: 'bag', perUnit: 1, expected: 12 },
      { unit: 'bag', perUnit: 1, expected: 30 },
    ]);
  });

  it('les poussins se comptent en cartons de 50 : 1 000 poussins à venir, 20 cartons ; 1 020, 21 cartons (arrondi au-dessus)', () => {
    expect(CHICKS_PER_BOX).toBe(50);
    expect([deliveryCounting('Chicks', 1000), deliveryCounting('Chicks', 1020), deliveryCounting('Chicks', 30)]).toEqual([
      { unit: 'box', perUnit: 50, expected: 20 },
      { unit: 'box', perUnit: 50, expected: 21 },
      { unit: 'box', perUnit: 50, expected: 1 },
    ]);
  });

  // Refactoring du 2026-11-14 : le bureau et les restes disaient chacun « au sac » ; la règle est ici
  it('au sac : l’aliment et la litière seulement — ni les poussins, ni la santé', () => {
    expect(['Feed', 'Bedding', 'Chicks', 'Health', 'Other'].map(byTheBag)).toEqual([true, true, false, false, false]);
  });

  it('le reste (santé, autre) se compte tel quel', () => {
    expect([deliveryCounting('Health', 6), deliveryCounting('Other', 2)]).toEqual([
      { unit: 'unit', perUnit: 1, expected: 6 },
      { unit: 'unit', perUnit: 1, expected: 2 },
    ]);
  });

  it('le reçu écrit vaut le compte multiplié par l’unité : 21 cartons, 1 050 poussins (un carton de bonus) ; 8 sacs, 8', () => {
    expect([receivedOf(21, deliveryCounting('Chicks', 1000)), receivedOf(8, deliveryCounting('Feed', 12)), receivedOf(0, deliveryCounting('Chicks', 1000))]).toEqual([1050, 8, 0]);
  });
});
