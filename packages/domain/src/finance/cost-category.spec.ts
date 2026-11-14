import { describe, expect, it } from 'vitest';
import { COST_CATEGORIES, DEFAULT_COST_TYPES, FEED_STAGES } from './cost-category';

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
// fondateur, 2026-11-09) ; backlog N.7 — les aliments selon l'âge (décision du 2026-11-13).
describe('Les types de départ de chaque élevage', () => {
  it('un type précoché par catégorie du socle, sauf Transformation ; l’aliment en trois, selon l’âge des poulets', () => {
    expect(DEFAULT_COST_TYPES.filter(({ checked }) => checked).map(({ name, category, bagWeight, checked }) => ({ name, category, bagWeight, checked }))).toEqual([
      { name: 'Aliment démarrage', category: 'Feed', bagWeight: 50_000, checked: true },
      { name: 'Aliment croissance', category: 'Feed', bagWeight: 50_000, checked: true },
      { name: 'Aliment finition', category: 'Feed', bagWeight: 50_000, checked: true },
      { name: 'Poussins', category: 'Chicks', bagWeight: null, checked: true },
      { name: 'Vaccins et soins', category: 'Health', bagWeight: null, checked: true },
      { name: 'Copeaux', category: 'Bedding', bagWeight: null, checked: true },
      { name: 'Salaire du gardien', category: 'Labour', bagWeight: null, checked: true },
      { name: 'Équipement', category: 'Equipment', bagWeight: null, checked: true },
      { name: 'Nettoyage et désinfection', category: 'Cleaning', bagWeight: null, checked: true },
      { name: 'Transport', category: 'Transport', bagWeight: null, checked: true },
      { name: 'Eau et électricité', category: 'Utilities', bagWeight: null, checked: true },
      { name: 'Frais financiers', category: 'FinancialCharges', bagWeight: null, checked: true },
      { name: 'Autres', category: 'Other', bagWeight: null, checked: true },
      // Rare (décision du fondateur du 2026-11-13) : un achat au poids, écrit 1 × le prix total ; en dernier
      { name: 'Aliment au kg', category: 'Feed', bagWeight: null, checked: true },
    ]);
    // Le poids habituel d'un sac (N.8a) : 50 kg pour les trois aliments selon l'âge ; aucun pour l'aliment au poids
    expect(DEFAULT_COST_TYPES.at(-1)).toMatchObject({ name: 'Aliment au kg', category: 'Feed', bagWeight: null, checked: true });
  });

  it('Déplumage et Congélation, sous Transformation, sont dans la liste mais décochés : tout le monde ne transforme pas', () => {
    expect(DEFAULT_COST_TYPES.filter(({ checked }) => !checked).map(({ name, category, bagWeight, checked }) => ({ name, category, bagWeight, checked }))).toEqual([
      { name: 'Déplumage', category: 'Processing', bagWeight: null, checked: false },
      { name: 'Congélation', category: 'Processing', bagWeight: null, checked: false },
    ]);
    expect(Object.isFrozen(DEFAULT_COST_TYPES)).toBe(true);
  });

  // Spec: backlog N.9 — le gardien distingue les aliments (décisions du fondateur du 2026-11-13)
  it('les trois aliments selon l’âge portent leur stade, qui donne au gardien la couleur du sac ; aucun autre type n’en a, pas même l’aliment au kg', () => {
    expect(DEFAULT_COST_TYPES.filter(({ feedStage }) => feedStage !== null).map(({ name, feedStage }) => [name, feedStage])).toEqual([
      ['Aliment démarrage', 'Starter'],
      ['Aliment croissance', 'Grower'],
      ['Aliment finition', 'Finisher'],
    ]);
    expect(FEED_STAGES).toEqual(['Starter', 'Grower', 'Finisher']);
  });
});
