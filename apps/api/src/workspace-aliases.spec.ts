import * as finance from '@domain/finance';
import * as journal from '@domain/journal';
import * as kit from '@kit';

// Spec: backlog A.3 — l'API atteint le domaine et le kit par leurs alias
describe('Alias du workspace dans les tests de l’API', () => {
  it('le domaine et le kit se résolvent par leurs alias', () => {
    expect([journal, finance, kit]).toHaveLength(3);
    expect(journal).toBeDefined();
    expect(finance).toBeDefined();
    expect(kit).toBeDefined();
  });
});
