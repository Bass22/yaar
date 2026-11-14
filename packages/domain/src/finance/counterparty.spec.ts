import { describe, expect, it } from 'vitest';
import { COUNTERPARTY_FACES, COUNTERPARTY_KINDS } from './counterparty';

// Spec: backlog N.3 — les tiers ; cahier des charges « Qui doit quoi » (le tiers : trois sortes,
// un visage pris dans une liste fermée de pictos d'objets réels — décisions du 2026-11-09).

describe('Un tiers', () => {
  it('est un fournisseur, un client ou un collaborateur, rien d’autre', () => {
    expect(COUNTERPARTY_KINDS).toEqual(['Supplier', 'Customer', 'Collaborator']);
  });

  it('a pour visage un picto d’objet réel, pris dans une liste fermée — le papier pour « autre »', () => {
    // « Une entreprise », pour un acheteur (demande du fondateur du 2026-11-13) : ajoutée en fin de liste, rien d'ancien ne change
    expect(COUNTERPARTY_FACES).toEqual(['closed-bag', 'chick', 'syringe', 'truck', 'caretaker', 'hen', 'drinker', 'barn', 'paper', 'shop']);
  });

  it('les deux listes ne se modifient pas en cours de route', () => {
    expect([Object.isFrozen(COUNTERPARTY_KINDS), Object.isFrozen(COUNTERPARTY_FACES)]).toEqual([true, true]);
  });
});
