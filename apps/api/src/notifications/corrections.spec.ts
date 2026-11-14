import { factWords } from './corrections';

// Spec: backlog Y.2b — la carte d'une correction dit l'ancienne et la nouvelle valeur, en mots,
// jamais un montant. Refactoring du 2026-11-14 : la moyenne d'une pesée est celle du domaine
// (`averageWeight`), que rien ne prouvait ici.

describe('Les mots d’une correction', () => {
  it('une pesée se dit par sa moyenne, arrondie au gramme le plus proche : (1820 + 1905 + 1760 + 1880 + 1853) ÷ 5 = 1843,6 → « 1844 g »', () => {
    expect(factWords('Weighing', { weights: [1820, 1905, 1760, 1880, 1853] })).toBe('pesée, moyenne 1844 g');
  });

  it('une pesée sans poids lisible se dit « une pesée »', () => {
    expect(factWords('Weighing', { weights: [] })).toBe('une pesée');
  });

  it('les morts, les sacs, les reçus se comptent, au singulier comme au pluriel', () => {
    expect([factWords('Death', { quantity: 1 }), factWords('BagOpened', { quantity: 2 }), factWords('Delivery', { receivedQuantity: 8 }), factWords('NoLoss', {})]).toEqual(['1 mort', '2 sacs ouverts', '8 reçus', 'rien perdu']);
  });
});
