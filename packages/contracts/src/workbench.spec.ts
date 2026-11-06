import { describe, expect, it } from 'vitest';

// Spec: backlog A.1 — chaque projet a un test qui passe
describe('Banc de test des contrats partagés', () => {
  it('le banc de test est branché', () => {
    expect(1 + 1).toBe(2);
  });
});
