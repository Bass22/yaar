import { unwrap, type Clock } from '@kit';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addDays, BusinessDay, businessDayAt, campaignDay, recentBusinessDays, TimeZone } from './business-day';

// Spec: Cahier des charges — « Jour J », « Rattrapage » (aujourd'hui, hier, avant-hier),
// « deux dates » (date métier choisie, date de saisie automatique) ; CLAUDE.md §8 — l'heure
// vient d'un port horloge.
// Les refus à la compilation (`@ts-expect-error`) sont vérifiés par `npx nx typecheck domain`.

const jour = (iso: string): BusinessDay => unwrap(BusinessDay(iso));
const fuseau = (name: string): TimeZone => unwrap(TimeZone(name));

const DAKAR = fuseau('Africa/Dakar'); // UTC+0, sans heure d'été
const DOUALA = fuseau('Africa/Douala'); // UTC+1

// A clock that only moves when the test says so.
function uneHorlogeReglee(iso: string): Clock & { advance(milliseconds: number): void } {
  let instant = Date.parse(iso);
  return {
    now: () => new Date(instant),
    advance: (milliseconds) => {
      instant += milliseconds;
    },
  };
}

const ONE_MINUTE = 60_000;

describe('Jour métier', () => {
  describe('une date sans heure', () => {
    it('un jour métier est une date du calendrier, sans heure', () => {
      for (const iso of ['2026-11-05', '2026-01-01', '2028-02-29']) {
        expect(BusinessDay(iso)).toEqual({ ok: true, value: iso });
      }
    });

    it("une date qui n'existe pas au calendrier est refusée", () => {
      for (const iso of ['2026-02-30', '2026-02-29', '2026-13-01', '2026-00-10', '2026-04-31']) {
        expect(BusinessDay(iso)).toEqual({ ok: false, error: { kind: 'InvalidBusinessDay' } });
      }
    });

    it("une date avec une heure, ou écrite autrement qu'en année-mois-jour, est refusée", () => {
      const others: unknown[] = ['2026-11-05T10:00:00Z', '05/11/2026', '2026-1-5', ' 2026-11-05', '', 20261105, null];

      for (const raw of others) {
        expect(BusinessDay(raw)).toEqual({ ok: false, error: { kind: 'InvalidBusinessDay' } });
      }
    });

    it("une chaîne non vérifiée ne passe pas pour un jour métier", () => {
      const summarize = (day: BusinessDay): string => day;

      expect(summarize(jour('2026-11-05'))).toBe('2026-11-05');
      // @ts-expect-error une chaîne quelconque n'est pas un jour métier vérifié
      summarize('2026-11-05');
    });
  });

  describe('dans le fuseau du site', () => {
    it("le même instant tombe sur deux jours métier selon le fuseau du site", () => {
      // Given 23 h 30 à Dakar, soit déjà 0 h 30 le lendemain à Douala
      const instant = new Date('2026-11-05T23:30:00Z');

      // Then
      expect(businessDayAt(instant, DAKAR)).toBe('2026-11-05');
      expect(businessDayAt(instant, DOUALA)).toBe('2026-11-06');
    });

    it('un fuseau inconnu est refusé', () => {
      const unknownZones: unknown[] = ['Mars/Olympus', 'Dakar', '', '+01:00 ou presque', 0, null];

      for (const raw of unknownZones) {
        expect(TimeZone(raw)).toEqual({ ok: false, error: { kind: 'InvalidTimeZone' } });
      }
    });

    it("un instant invalide est une panne, pas un refus métier", () => {
      expect(() => businessDayAt(new Date(Number.NaN), DAKAR)).toThrow(RangeError);
    });
  });

  describe('jour J de la campagne', () => {
    it('le jour de la mise en place est le jour J0', () => {
      expect(campaignDay(jour('2026-10-15'), jour('2026-10-15'))).toBe(0);
    });

    it('le jour J se déduit de la mise en place et du jour métier', () => {
      // Given des poussins mis en place le 15 octobre
      const placementDay = jour('2026-10-15');

      // Then le 5 novembre : 16 jours d'octobre restants + 5 jours de novembre = J21
      expect(campaignDay(placementDay, jour('2026-10-16'))).toBe(1);
      expect(campaignDay(placementDay, jour('2026-11-05'))).toBe(21);
    });

    it("le jour J traverse le changement d'année et le 29 février", () => {
      expect(campaignDay(jour('2026-12-20'), jour('2027-01-10'))).toBe(21);
      expect(campaignDay(jour('2028-02-20'), jour('2028-03-01'))).toBe(10);
    });

    it('un jour antérieur à la mise en place donne un jour J négatif, jamais bridé à zéro', () => {
      expect(campaignDay(jour('2026-10-15'), jour('2026-10-14'))).toBe(-1);
    });

    it("pour tout jour et tout décalage n, le jour J du jour décalé de n vaut n (property-based)", () => {
      const anOffset = fc.integer({ min: -800, max: 800 });

      fc.assert(
        fc.property(anOffset, anOffset, (fromEpoch, n) => {
          const placementDay = addDays(jour('2026-01-01'), fromEpoch);

          return campaignDay(placementDay, addDays(placementDay, n)) === n;
        }),
      );
    });
  });

  describe("aujourd'hui, hier, avant-hier", () => {
    it("se déduisent de l'horloge fournie", () => {
      // Given le 5 novembre à 8 h à Dakar
      const clock = uneHorlogeReglee('2026-11-05T08:00:00Z');

      // When
      const days = recentBusinessDays(clock.now(), DAKAR);

      // Then
      expect(days).toEqual({ today: '2026-11-05', yesterday: '2026-11-04', dayBeforeYesterday: '2026-11-03' });
    });

    it('reculent à travers le mois et l’année', () => {
      expect(recentBusinessDays(new Date('2026-03-01T08:00:00Z'), DAKAR)).toEqual({
        today: '2026-03-01',
        yesterday: '2026-02-28',
        dayBeforeYesterday: '2026-02-27',
      });
      expect(recentBusinessDays(new Date('2027-01-01T08:00:00Z'), DAKAR)).toEqual({
        today: '2027-01-01',
        yesterday: '2026-12-31',
        dayBeforeYesterday: '2026-12-30',
      });
    });

    it("à minuit passé, « aujourd'hui » change sans que la date de saisie d'un événement déjà créé change", () => {
      // Given un événement saisi le 5 novembre à 23 h 59
      const clock = uneHorlogeReglee('2026-11-05T23:59:30Z');
      const recordedAt = clock.now();
      const todayAtRecording = recentBusinessDays(clock.now(), DAKAR).today;

      // When une minute passe
      clock.advance(ONE_MINUTE);

      // Then on est le 6, hier est le 5, et la date de saisie n'a pas bougé
      expect(todayAtRecording).toBe('2026-11-05');
      expect(recentBusinessDays(clock.now(), DAKAR)).toMatchObject({ today: '2026-11-06', yesterday: '2026-11-05' });
      expect(recordedAt.toISOString()).toBe('2026-11-05T23:59:30.000Z');
      expect(businessDayAt(recordedAt, DAKAR)).toBe('2026-11-05');
    });
  });
});
