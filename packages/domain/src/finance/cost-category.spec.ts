import { describe, expect, it } from 'vitest';
import { COST_CATEGORIES, DEFAULT_COST_TYPES } from './cost-category';

// Spec: backlog N.1 — le socle de l'éditeur ; cahier des charges « Référentiels à deux niveaux »
// (douze catégories, Literie et Transformation ajoutées et drapeaux fixe / variable et commandable : décisions du 2026-11-08).

describe("Le socle des catégories de coût", () => {
  it("compte douze catégories, dans l'ordre du cahier des charges", () => {
    // Aliments, Poussins, Santé, Literie, Main-d'œuvre, Équipement, Nettoyage, Transport,
    // Transformation, Énergie/Eau, Frais financiers, Autres.
    expect(COST_CATEGORIES.map(({ category }) => category)).toEqual([
      'Feed',
      'Chicks',
      'Health',
      'Bedding',
      'Labour',
      'Equipment',
      'Cleaning',
      'Transport',
      'Processing',
      'Utilities',
      'FinancialCharges',
      'Other',
    ]);
  });

  it('chaque catégorie porte son drapeau : variable si elle grossit avec l’effectif, fixe sinon', () => {
    const fixed = COST_CATEGORIES.filter(({ behaviour }) => behaviour === 'Fixed').map(({ category }) => category);
    const variable = COST_CATEGORIES.filter(({ behaviour }) => behaviour === 'Variable').map(({ category }) => category);

    expect(fixed).toEqual(['Labour', 'Equipment', 'Cleaning', 'FinancialCharges']);
    expect(variable).toEqual(['Feed', 'Chicks', 'Health', 'Bedding', 'Transport', 'Processing', 'Utilities', 'Other']);
  });

  it('Aliments, Poussins, Santé et Literie se commandent ; les autres sont des coûts directs', () => {
    expect(COST_CATEGORIES.filter(({ orderable }) => orderable).map(({ category }) => category)).toEqual(['Feed', 'Chicks', 'Health', 'Bedding']);
  });

  it('le socle ne se modifie pas en cours de route : ni catégorie retirée, ni drapeau changé', () => {
    expect(Object.isFrozen(COST_CATEGORIES)).toBe(true);
    expect(COST_CATEGORIES.every((entry) => Object.isFrozen(entry))).toBe(true);
  });
});

// Spec: backlog N.2 — les types propres à l'élevage ; cahier des charges « Référentiels à deux
// niveaux » (les types de départ : une liste précochée, Transformation décochée — décision du
// fondateur, 2026-11-09).
describe('Les types de départ de chaque élevage', () => {
  it('un type précoché par catégorie du socle, sauf Transformation', () => {
    expect(DEFAULT_COST_TYPES.filter(({ checked }) => checked)).toEqual([
      { name: 'Aliment', category: 'Feed', checked: true },
      { name: 'Poussins', category: 'Chicks', checked: true },
      { name: 'Vaccins et soins', category: 'Health', checked: true },
      { name: 'Copeaux', category: 'Bedding', checked: true },
      { name: 'Salaire du gardien', category: 'Labour', checked: true },
      { name: 'Équipement', category: 'Equipment', checked: true },
      { name: 'Nettoyage et désinfection', category: 'Cleaning', checked: true },
      { name: 'Transport', category: 'Transport', checked: true },
      { name: 'Eau et électricité', category: 'Utilities', checked: true },
      { name: 'Frais financiers', category: 'FinancialCharges', checked: true },
      { name: 'Autres', category: 'Other', checked: true },
    ]);
  });

  it('Déplumage et Congélation, sous Transformation, sont dans la liste mais décochés : tout le monde ne transforme pas', () => {
    expect(DEFAULT_COST_TYPES.filter(({ checked }) => !checked)).toEqual([
      { name: 'Déplumage', category: 'Processing', checked: false },
      { name: 'Congélation', category: 'Processing', checked: false },
    ]);
    expect(Object.isFrozen(DEFAULT_COST_TYPES)).toBe(true);
  });
});
