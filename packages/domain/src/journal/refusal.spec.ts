import { describe, expect, it } from 'vitest';
import { SiteId } from './ids';
import type { Refusal, RefusalKind } from './refusal';

// Spec: CLAUDE.md §8 — erreurs métier typées ; backlog B.3 — les motifs forment une liste fermée.

// One sample per reason: a reason added to the list without a sample fails `nx typecheck domain`.
const samples: { readonly [Kind in RefusalKind]: Extract<Refusal, { kind: Kind }> } = {
  InvalidId: { kind: 'InvalidId', expected: 'SiteId' },
};

// Total function over the closed list: a reason added without its `case` fails the typecheck.
function explain(refusal: Refusal): string {
  switch (refusal.kind) {
    case 'InvalidId':
      return `identifiant invalide : ${refusal.expected}`;
    default:
      return assertNever(refusal.kind);
  }
}

function assertNever(value: never): never {
  throw new Error(`motif de refus non traité : ${JSON.stringify(value)}`);
}

describe('Motifs de refus du journal', () => {
  it('chaque motif de la liste fermée est traité par une fonction totale', () => {
    for (const refusal of Object.values(samples)) {
      expect(explain(refusal)).toMatch(/\S/);
    }
  });

  it('un motif hors de la liste ne se compile pas', () => {
    // @ts-expect-error `Unlucky` n'est pas un motif de la liste
    const unknown: Refusal = { kind: 'Unlucky' };

    expect(unknown).toBeDefined();
  });

  it('un refus métier est un résultat typé qui porte son motif, jamais une exception', () => {
    // When
    const attempt = (): unknown => SiteId('pas-un-uuid');

    // Then
    expect(attempt).not.toThrow();
    expect(attempt()).toEqual({ ok: false, error: samples.InvalidId });
  });
});
