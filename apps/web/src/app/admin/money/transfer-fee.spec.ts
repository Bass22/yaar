import type { CostTypeView } from '@contracts';
import { feeTypeOf, takesFee } from './transfer-fee';

// Spec: backlog P.8 — les frais Wave et Orange Money s'écrivent au type « Frais financiers » de
// l'élevage, encore en usage ; les espèces n'en ont pas (décisions du 2026-11-12).
const type = (id: string, category: CostTypeView['category'], archived: boolean): CostTypeView => ({ id, category, name: id, behaviour: 'Fixed', orderable: false, archived });

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
});
