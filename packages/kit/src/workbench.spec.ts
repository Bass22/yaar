import { describe, expect, it } from 'vitest';

// Spec: backlog A.5 — le kit est testé avec Vitest comme les autres packages
describe('Banc de test du kit', () => {
  it('le banc de test est branché', () => {
    expect(1 + 1).toBe(2);
  });
});
