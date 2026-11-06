import { unwrap } from '@kit';
import { describe, expect, it } from 'vitest';
import { Instant, instantOf } from './instant';

// Spec: Cahier des charges — « deux dates » (date de saisie automatique) ; CLAUDE.md §4 règle 2.
// Les refus à la compilation (`@ts-expect-error`) sont vérifiés par `npx nx typecheck domain`.

describe('Instant de saisie', () => {
  it("un instant s'écrit en temps universel, à la milliseconde", () => {
    expect(Instant('2026-11-05T23:59:30.000Z')).toEqual({ ok: true, value: '2026-11-05T23:59:30.000Z' });
  });

  it("un même instant n'a qu'une écriture : décalage horaire, heure locale ou précision réduite sont refusés", () => {
    const otherSpellings: unknown[] = [
      '2026-11-06T00:59:30.000+01:00',
      '2026-11-05T23:59:30Z',
      '2026-11-05T23:59:30.000',
      '2026-11-05 23:59:30.000Z',
      '2026-11-05',
      ' 2026-11-05T23:59:30.000Z',
    ];

    for (const raw of otherSpellings) {
      expect(Instant(raw)).toEqual({ ok: false, error: { kind: 'InvalidInstant' } });
    }
  });

  it("un instant qui n'existe pas est refusé", () => {
    for (const raw of ['2026-02-30T10:00:00.000Z', '2026-11-05T24:00:00.000Z', '2026-11-05T10:60:00.000Z']) {
      expect(Instant(raw)).toEqual({ ok: false, error: { kind: 'InvalidInstant' } });
    }
  });

  it('deux instants se comparent comme deux textes : une année à plus de quatre chiffres est refusée', () => {
    expect(Instant('+010000-01-01T00:00:00.000Z')).toEqual({ ok: false, error: { kind: 'InvalidInstant' } });
    expect(unwrap(Instant('2026-11-05T09:00:00.000Z')) < unwrap(Instant('2026-11-05T18:30:00.000Z'))).toBe(true);
  });

  it("ce qui n'est pas un texte est refusé", () => {
    for (const raw of [1_793_923_170_000, new Date('2026-11-05T23:59:30.000Z'), null, undefined]) {
      expect(Instant(raw)).toEqual({ ok: false, error: { kind: 'InvalidInstant' } });
    }
  });

  it("l'instant lu sur l'horloge devient un instant de saisie, sans perte", () => {
    // Given l'heure fournie par l'horloge : 0 h 59 à Douala, soit 23 h 59 en temps universel
    const now = new Date('2026-11-06T00:59:30.123+01:00');

    // When
    const recordedAt = instantOf(now);

    // Then
    expect(recordedAt).toBe('2026-11-05T23:59:30.123Z');
    expect(new Date(recordedAt).getTime()).toBe(now.getTime());
    expect(Instant(recordedAt)).toEqual({ ok: true, value: recordedAt });
  });

  it('une heure invalide est une panne, pas un refus métier', () => {
    expect(() => instantOf(new Date(Number.NaN))).toThrow(RangeError);
  });

  it("un texte non vérifié ne passe pas pour un instant", () => {
    const record = (at: Instant): string => at;

    expect(record(instantOf(new Date('2026-11-05T08:00:00.000Z')))).toBe('2026-11-05T08:00:00.000Z');
    // @ts-expect-error un texte quelconque n'est pas un instant vérifié
    record('2026-11-05T08:00:00.000Z');
  });
});
