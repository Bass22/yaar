import { Money, SignedMoney, unwrap, type CurrencyCode } from '@kit';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { budgetVariance, committedByCategory, recordBudget, suggestedBudget, type ClosedCampaignCosts } from './budget';
import type { CostCategory } from './cost-category';

// Spec: backlog S.1 — le budget est un plan, jamais une dette ; cahier des charges « Budget de
// campagne » (décisions du fondateur du 2026-11-12 : un poste = une catégorie ; proposition =
// médiane du coût par poussin reçu des bandes closes × effectif prévu ; écart = budget − engagé).

const XOF = 'XOF' as CurrencyCode;
const F = (amount: number): Money => unwrap(Money.of(amount, XOF));
const S = (amount: number): SignedMoney => unwrap(SignedMoney.of(amount, XOF));
const close = (chicksReceived: number, costs: Partial<Record<CostCategory, number>>): ClosedCampaignCosts => ({
  chicksReceived,
  byCategory: new Map(Object.entries(costs).map(([category, amount]) => [category as CostCategory, S(amount)])),
});

describe('Le budget d’une bande', () => {
  describe('écrire un budget', () => {
    it('par poste (une catégorie), en francs entiers, zéro permis ; un poste peut rester sans budget', () => {
      const budget = recordBudget(
        [
          { category: 'Feed', amount: 1_200_000 },
          { category: 'Bedding', amount: 0 },
          { category: 'Health', amount: null },
        ],
        XOF,
      );

      expect(budget.ok && budget.value).toEqual([
        { category: 'Feed', amount: F(1_200_000) },
        { category: 'Bedding', amount: F(0) },
        { category: 'Health', amount: null },
      ]);
    });

    it.each([-1, 1.5, Number.NaN])('un montant qui n’est pas un entier positif est refusé : %s', (amount) => {
      const budget = recordBudget([{ category: 'Feed', amount }], XOF);

      expect(budget.ok ? null : budget.error).toEqual({ kind: 'InvalidAmount', category: 'Feed' });
    });

    it('un poste qui n’est pas une catégorie du socle est refusé', () => {
      const budget = recordBudget([{ category: 'Aliment', amount: 1 }], XOF);

      expect(budget.ok ? null : budget.error).toEqual({ kind: 'UnknownCategory', category: 'Aliment' });
    });

    it('un poste n’a qu’une ligne', () => {
      const budget = recordBudget([{ category: 'Feed', amount: 1 }, { category: 'Feed', amount: 2 }], XOF);

      expect(budget.ok ? null : budget.error).toEqual({ kind: 'DuplicateCategory', category: 'Feed' });
    });
  });

  describe('la proposition depuis l’historique', () => {
    it('la médiane du coût par poussin reçu des bandes closes × l’effectif prévu, arrondie au franc', () => {
      // Aliment par poussin : 1 200 000 ÷ 1 000 = 1 200 ; 1 300 000 ÷ 1 000 = 1 300 ; 700 000 ÷ 500 = 1 400 → médiane 1 300
      // × 1 050 poussins prévus = 1 365 000 F
      const history = [close(1000, { Feed: 1_200_000 }), close(1000, { Feed: 1_300_000 }), close(500, { Feed: 700_000 })];

      expect(suggestedBudget(history, 1050, XOF).get('Feed')).toEqual(F(1_365_000));
    });

    it('un nombre pair de bandes : la moyenne des deux du milieu', () => {
      // Santé par poussin : 100, 120, 130, 500 → (120 + 130) ÷ 2 = 125 × 1 000 = 125 000 F (une bande atypique ne tire pas tout)
      const history = [close(1000, { Health: 100_000 }), close(1000, { Health: 500_000 }), close(1000, { Health: 120_000 }), close(1000, { Health: 130_000 })];

      expect(suggestedBudget(history, 1000, XOF).get('Health')).toEqual(F(125_000));
    });

    it('une bande qui n’a rien dépensé sur un poste compte pour zéro dans la médiane', () => {
      // Transport par poussin : 0, 0, 30 → médiane 0 : rien n'est proposé
      const history = [close(1000, {}), close(1000, {}), close(1000, { Transport: 30_000 })];

      expect(suggestedBudget(history, 1000, XOF).has('Transport')).toBe(false);
    });

    it('sans bande close, rien n’est proposé : la case reste vide, pas à zéro', () => {
      expect(suggestedBudget([], 1000, XOF).size).toBe(0);
    });

    it('une bande close sans poussin reçu ne compte pas', () => {
      // Seule la bande de 1 000 poussins compte : 1 200 × 1 000 = 1 200 000 F
      const history = [close(0, { Feed: 900_000 }), close(1000, { Feed: 1_200_000 })];

      expect(suggestedBudget(history, 1000, XOF).get('Feed')).toEqual(F(1_200_000));
    });

    it('l’arrondi se fait une fois, à la fin', () => {
      // 1 000 ÷ 3 = 333,33 par poussin × 2 = 666,67 → 667 F
      expect(suggestedBudget([close(3, { Feed: 1_000 })], 2, XOF).get('Feed')).toEqual(F(667));
    });

    it('l’ordre des bandes ne change rien', () => {
      const history = [close(1000, { Feed: 1_200_000 }), close(800, { Feed: 1_100_000 }), close(500, { Feed: 700_000 }), close(1200, { Feed: 1_500_000 })];
      fc.assert(
        fc.property(fc.shuffledSubarray(history, { minLength: history.length }), (shuffled) => {
          expect(suggestedBudget(shuffled, 1000, XOF)).toEqual(suggestedBudget(history, 1000, XOF));
        }),
      );
    });
  });

  describe('l’engagé par poste et l’écart', () => {
    it('l’engagé se range par catégorie', () => {
      const engage = committedByCategory(
        [
          { category: 'Feed', amount: F(300_000) },
          { category: 'Chicks', amount: F(550_000) },
          { category: 'Feed', amount: F(160_000) },
        ],
        XOF,
      );

      expect(engage).toEqual(
        new Map([
          ['Feed', F(460_000)],
          ['Chicks', F(550_000)],
        ]),
      );
    });

    it('écart = budget − engagé : au-dessus de zéro il reste de la marge, au-dessous le poste dépasse', () => {
      expect(budgetVariance(F(1_200_000), F(1_000_000))).toEqual(S(200_000));
      expect(budgetVariance(F(1_200_000), F(1_350_000))).toEqual(S(-150_000));
    });

    it('sans budget, pas d’écart — jamais zéro', () => {
      expect(budgetVariance(null, F(1_000_000))).toBeNull();
    });
  });
});
