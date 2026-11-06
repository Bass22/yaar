import { unwrap } from '@kit';
import { Instant } from '@domain/journal';
import fc from 'fast-check';
import { afterFailure, afterSuccess, NO_FAILURE, retryAt, type PinAttempts } from './pin-attempts';

// Spec: Cahier des charges — « Identité », essais ratés : trois essais libres, puis une attente
// qui s'allonge (30 s, 1 min, 5 min, 15 min, 1 h au plus), jamais de blocage définitif ; le
// compteur repart de zéro après une connexion réussie. Backlog E.1 ; CLAUDE.md §4 règle 6.

const instant = (iso: string): Instant => unwrap(Instant(iso));
const A_18H = instant('2026-11-06T18:00:00.000Z');
const later = (from: Instant, seconds: number): Instant => instant(new Date(Date.parse(from) + seconds * 1_000).toISOString());

// The n-th failure in a row, every one of them made at 18:00.
const apres = (failures: number): PinAttempts =>
  Array.from({ length: failures }).reduce<PinAttempts>((attempts) => afterFailure(attempts, A_18H), NO_FAILURE);

describe('Essais de PIN', () => {
  describe('trois essais libres', () => {
    it("sans essai raté, on peut essayer tout de suite", () => {
      expect(retryAt(NO_FAILURE, A_18H)).toBeNull();
    });

    it("après un ou deux essais ratés, on peut encore essayer tout de suite : le troisième essai est libre", () => {
      expect(retryAt(apres(1), A_18H)).toBeNull();
      expect(retryAt(apres(2), A_18H)).toBeNull();
    });
  });

  describe("l'attente s'allonge", () => {
    it('après le 3e essai raté il faut attendre 30 secondes, puis 1 minute, 5 minutes, 15 minutes', () => {
      // Given des essais tous ratés à 18 h 00, et une nouvelle tentative une seconde plus tard
      const oneSecondLater = later(A_18H, 1);
      const waits = [3, 4, 5, 6].map((failures) => retryAt(apres(failures), oneSecondLater));

      // Then 18 h 00 min 30 s, 18 h 01, 18 h 05, 18 h 15
      expect(waits).toEqual(['2026-11-06T18:00:30.000Z', '2026-11-06T18:01:00.000Z', '2026-11-06T18:05:00.000Z', '2026-11-06T18:15:00.000Z']);
    });

    it("à partir du 7e essai raté l'attente est d'une heure, et ne grandit plus : jamais de blocage définitif", () => {
      for (const failures of [7, 8, 20, 500]) {
        expect(retryAt(apres(failures), later(A_18H, 1))).toBe('2026-11-06T19:00:00.000Z');
        expect(retryAt(apres(failures), later(A_18H, 3_600))).toBeNull();
      }
    });

    it("l'attente écoulée, on peut réessayer : à la seconde près", () => {
      // Given trois essais ratés à 18 h 00 : 30 secondes d'attente
      const attempts = apres(3);

      // Then à 18 h 00 min 29 s il faut encore attendre ; à 18 h 00 min 30 s, non
      expect(retryAt(attempts, later(A_18H, 29))).toBe('2026-11-06T18:00:30.000Z');
      expect(retryAt(attempts, later(A_18H, 30))).toBeNull();
      expect(retryAt(attempts, later(A_18H, 86_400))).toBeNull();
    });

    it("l'attente se compte depuis le dernier essai raté, pas depuis le premier", () => {
      // Given trois essais ratés à 18 h 00, puis un quatrième à 18 h 10
      const fourth = afterFailure(apres(3), later(A_18H, 600));

      // Then une minute après 18 h 10
      expect(retryAt(fourth, later(A_18H, 601))).toBe('2026-11-06T18:11:00.000Z');
    });
  });

  describe('dans le doute, on attend', () => {
    it("des essais ratés sans date du dernier font attendre à partir de maintenant : ils n'ouvrent pas la porte", () => {
      const withoutDate: PinAttempts = { failures: 5, lastFailureAt: null };

      expect(retryAt(withoutDate, A_18H)).toBe('2026-11-06T18:05:00.000Z');
    });

    it("un compteur illisible fait attendre le plus longtemps", () => {
      for (const failures of [Number.NaN, Number.POSITIVE_INFINITY, 3.5]) {
        expect(retryAt({ failures, lastFailureAt: A_18H }, later(A_18H, 1))).toBe('2026-11-06T19:00:00.000Z');
      }
    });
  });

  describe('le compteur', () => {
    it('chaque essai raté compte un de plus', () => {
      expect(apres(1)).toEqual({ failures: 1, lastFailureAt: A_18H });
      expect(apres(4)).toEqual({ failures: 4, lastFailureAt: A_18H });
    });

    it('une connexion réussie remet le compteur à zéro', () => {
      expect(afterSuccess()).toEqual(NO_FAILURE);
      expect(retryAt(afterSuccess(), A_18H)).toBeNull();
      expect(afterFailure(afterSuccess(), A_18H)).toEqual({ failures: 1, lastFailureAt: A_18H });
    });

    it("compter un essai raté ne modifie pas l'état qu'on lui donne", () => {
      const before = apres(2);
      const snapshot = JSON.stringify(before);

      afterFailure(before, A_18H);

      expect(JSON.stringify(before)).toBe(snapshot);
      expect(NO_FAILURE).toEqual({ failures: 0, lastFailureAt: null });
    });
  });

  it("pour tout nombre d'essais ratés, l'attente ne dépasse jamais une heure et ne raccourcit jamais (property-based)", () => {
    const waitAfter = (failures: number): number => {
      const allowedAt = retryAt(apres(failures), A_18H);
      return allowedAt === null ? 0 : (Date.parse(allowedAt) - Date.parse(A_18H)) / 1_000;
    };

    fc.assert(
      fc.property(fc.integer({ min: 0, max: 200 }), (failures) => {
        expect(waitAfter(failures)).toBeLessThanOrEqual(3_600);
        expect(waitAfter(failures + 1)).toBeGreaterThanOrEqual(waitAfter(failures));
      }),
    );
  });
});
