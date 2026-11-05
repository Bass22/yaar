import * as kit from '@kit';
import { describe, expect, it } from 'vitest';

// Spec: backlog A.1 — chaque projet a un test qui passe
describe('Banc de test du domaine', () => {
  it('le banc de test est branché', () => {
    expect(1 + 1).toBe(2);
  });

  // Spec: backlog A.2 — un alias du workspace se résout aussi dans les tests
  it('le domaine atteint le kit par son alias', () => {
    expect(kit).toBeDefined();
  });
});
