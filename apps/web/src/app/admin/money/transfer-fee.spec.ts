import type { CostTypeView } from '@contracts';
import { feeCost, feeTypeOf, takesFee } from './transfer-fee';

// Spec: backlog P.8 — les frais Wave et Orange Money s'écrivent au type « Frais financiers » de
// l'élevage, encore en usage ; les espèces n'en ont pas (décisions du 2026-11-12).
const type = (id: string, category: CostTypeView['category'], archived: boolean): CostTypeView => ({ id, category, name: id, behaviour: 'Fixed', bagWeight: null, orderable: false, archived });

describe('Les frais d’un transfert', () => {
  it('seuls Wave et Orange Money coûtent des frais ; les espèces, jamais', () => {
    expect([takesFee('Wave'), takesFee('OrangeMoney'), takesFee('Cash'), takesFee(null)]).toEqual([true, true, false, false]);
  });

  it('ils s’écrivent au type « Frais financiers » encore en usage ; archivé, ou absent, aucun', () => {
    expect(feeTypeOf([type('aliment', 'Feed', false), type('frais', 'FinancialCharges', false)])).toBe('frais');
    expect(feeTypeOf([type('ancien', 'FinancialCharges', true), type('frais', 'FinancialCharges', false)])).toBe('frais');
    expect(feeTypeOf([type('ancien', 'FinancialCharges', true)])).toBeNull();
    expect(feeTypeOf([])).toBeNull();
  });

  // Spec: backlog R.4 — les frais d'un tiers qui a payé pour l'élevage, pris en charge : ils se déduisent de ce qu'il doit.
  it('les frais d’un tiers qui a payé : « payés par » lui, même sans moyen choisi (une dépense) ; la note dit qui', () => {
    const fee = feeCost({ id: 'f', typed: '1000', method: null, campaignId: 'b', costTypeId: 'frais', on: '2026-11-12', about: 'aliment payé par Moussa', paidBy: 'moussa' });

    expect(fee).toEqual({ kind: 'cost', request: { id: 'f', campaignId: 'b', costTypeId: 'frais', spentOn: '2026-11-12', amount: 1_000, note: 'Frais de transfert — aliment payé par Moussa', payment: { kind: 'PaidBy', counterpartyId: 'moussa' }, receipt: null } });
  });

  it('sans tiers, rien sans Wave ni Orange Money', () => {
    expect(feeCost({ id: 'f', typed: '1000', method: null, campaignId: 'b', costTypeId: 'frais', on: '2026-11-12', about: 'x' })).toEqual({ kind: 'none' });
  });
});
