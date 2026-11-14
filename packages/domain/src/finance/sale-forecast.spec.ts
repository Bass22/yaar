import { Money, SignedMoney, unwrap, type CurrencyCode } from '@kit';
import { describe, expect, it } from 'vitest';
import { forecastSummary, recordSaleForecast, type SaleForecastInput } from './sale-forecast';

// Spec: backlog W.4 — les ventes prévues, acheteur par acheteur ; cahier des charges « Les ventes
// prévues » (décisions du fondateur du 2026-11-13 : par tête, le poids prévu est indicatif ; au kilo,
// il est obligatoire et fait la recette ; la marge prévue = recettes prévues − budget ; jamais une créance).

const XOF = 'XOF' as CurrencyCode;
const F = (amount: number): Money => unwrap(Money.of(amount, XOF));
const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const MOUSSA = uuid(33);
const SEDIMA = uuid(31);
const ANCIEN = uuid(34);
const contexte = { currency: XOF, placementDay: '2026-10-12', buyers: [{ id: MOUSSA, kind: 'Customer' as const, archived: false }, { id: SEDIMA, kind: 'Supplier' as const, archived: false }, { id: ANCIEN, kind: 'Customer' as const, archived: true }] };
const prevue = (fields: Partial<SaleForecastInput> = {}): SaleForecastInput => ({ forecastId: uuid(1), buyerId: MOUSSA, week: '2026-11-23', birds: 200, pricing: { kind: 'PerBird', price: 2_750 }, averageWeight: 2_200, ...fields });

describe('Une vente prévue', () => {
  it('l’acheteur, la semaine, les poulets, le prix par tête ; le poids moyen prévu, à titre indicatif', () => {
    expect(recordSaleForecast(prevue(), contexte)).toEqual({ ok: true, value: { forecastId: uuid(1), buyerId: MOUSSA, week: '2026-11-23', birds: 200, pricing: { kind: 'PerBird', price: F(2_750) }, averageWeight: 2_200 } });
    expect(recordSaleForecast(prevue({ averageWeight: null }), contexte)).toMatchObject({ ok: true, value: { averageWeight: null } });
  });

  it('au kilo, le poids moyen prévu est obligatoire : c’est lui qui fait la recette', () => {
    expect(recordSaleForecast(prevue({ pricing: { kind: 'PerKilo', price: 1_200 }, averageWeight: null }), contexte)).toEqual({ ok: false, error: { kind: 'MissingWeight' } });
    expect(recordSaleForecast(prevue({ pricing: { kind: 'PerKilo', price: 1_200 }, averageWeight: 2_200 }), contexte)).toMatchObject({ ok: true, value: { pricing: { kind: 'PerKilo', price: F(1_200) } } });
  });

  it('un acheteur en usage seulement : ni un fournisseur, ni un archivé, ni un inconnu', () => {
    expect([recordSaleForecast(prevue({ buyerId: SEDIMA }), contexte), recordSaleForecast(prevue({ buyerId: ANCIEN }), contexte), recordSaleForecast(prevue({ buyerId: uuid(99) }), contexte)]).toEqual([
      { ok: false, error: { kind: 'UnknownBuyer' } },
      { ok: false, error: { kind: 'UnknownBuyer' } },
      { ok: false, error: { kind: 'UnknownBuyer' } },
    ]);
  });

  it('au moins un poulet, un prix en francs entiers (zéro permis), un poids au-dessus de zéro s’il est dit, une semaine de la bande', () => {
    expect([
      recordSaleForecast(prevue({ birds: 0 }), contexte),
      recordSaleForecast(prevue({ birds: 2.5 }), contexte),
      recordSaleForecast(prevue({ pricing: { kind: 'PerBird', price: -1 } }), contexte),
      recordSaleForecast(prevue({ averageWeight: 0 }), contexte),
      recordSaleForecast(prevue({ week: '2026-10-05' }), contexte),
      recordSaleForecast(prevue({ week: 'lundi' }), contexte),
      recordSaleForecast(prevue({ forecastId: 'vente' }), contexte),
    ]).toEqual([
      { ok: false, error: { kind: 'InvalidBirds' } },
      { ok: false, error: { kind: 'InvalidBirds' } },
      { ok: false, error: { kind: 'InvalidPrice' } },
      { ok: false, error: { kind: 'InvalidWeight' } },
      { ok: false, error: { kind: 'WeekBeforePlacement' } },
      { ok: false, error: { kind: 'InvalidBusinessDay' } },
      { ok: false, error: { kind: 'InvalidId' } },
    ]);
    expect(recordSaleForecast(prevue({ pricing: { kind: 'PerBird', price: 0 } }), contexte).ok).toBe(true);
  });
});

describe('Les recettes et la marge prévues', () => {
  const ventes = [unwrap(recordSaleForecast(prevue(), contexte)), unwrap(recordSaleForecast(prevue({ forecastId: uuid(2), birds: 300, pricing: { kind: 'PerBird', price: 2_600 }, averageWeight: 9_999 }), contexte))];

  it('les recettes prévues : chaque vente, poulets × prix par tête — le poids n’y compte pas', () => {
    // 200 × 2 750 + 300 × 2 600 = 550 000 + 780 000 = 1 330 000 F
    expect(forecastSummary(ventes, F(900_000), F(0)).expectedRevenue).toEqual(F(1_330_000));
  });

  it('au kilo : poulets × poids moyen × prix du kilo, arrondi au franc', () => {
    // 300 × 2,2 kg × 1 200 = 792 000 F ; 3 × 2,333 kg × 1 150 = 8 048,85 → 8 049 F (au franc le plus proche)
    const auKilo = (birds: number, averageWeight: number, price: number) => unwrap(recordSaleForecast(prevue({ birds, pricing: { kind: 'PerKilo', price }, averageWeight }), contexte));
    expect([forecastSummary([auKilo(300, 2_200, 1_200)], null, F(0)).expectedRevenue, forecastSummary([auKilo(3, 2_333, 1_150)], null, F(0)).expectedRevenue]).toEqual([F(792_000), F(8_049)]);
  });

  it('la marge prévue : recettes prévues − budget, signée ; sans budget, absente — jamais zéro', () => {
    expect(forecastSummary(ventes, F(900_000), F(0)).expectedMargin).toEqual(unwrap(SignedMoney.of(430_000, XOF)));
    expect(forecastSummary(ventes, F(1_500_000), F(0)).expectedMargin).toEqual(unwrap(SignedMoney.of(-170_000, XOF)));
    expect(forecastSummary(ventes, null, F(0)).expectedMargin).toBeNull();
  });

  it('le réalisé se lit à côté : le chiffre d’affaires des ventes faites', () => {
    expect(forecastSummary(ventes, null, F(550_000)).realized).toEqual(F(550_000));
  });

  it('aucune vente prévue : des recettes prévues à zéro, écrites zéro parce qu’on n’a rien prévu', () => {
    expect(forecastSummary([], null, F(0)).expectedRevenue).toEqual(F(0));
  });
});
