import { describe, expect, it } from 'vitest';
import { STRAINS, targetAt, type Strain } from './strain';

// Spec: backlog N.4 — les souches et la table Cobb 500 ; cahier des charges « Référentiels »
// (souches, espèce attribut de la souche ; table du guide « Cobb 500 Performances et
// Recommandations Nutritionnelles », colonne tout-venant, fournie par le fondateur le 2026-11-09) ;
// CLAUDE.md §4 règle 10 (absent n'est pas zéro).

const cobb = (): Strain => {
  const strain = STRAINS.find(({ code }) => code === 'Cobb500');
  if (strain === undefined) throw new Error('Cobb 500 is missing');
  return strain;
};
const at = (day: number) => targetAt(cobb(), day);

// The source, as printed: age, weight, daily feed, cumulative feed, feed conversion (null: empty cell).
const GUIDE: ReadonlyArray<readonly [number, number, number | null, number | null, number | null]> = [
  [0, 41, null, null, null], [1, 52, null, null, null], [2, 64, null, null, null], [3, 78, null, null, null],
  [4, 95, null, null, null], [5, 115, null, null, null], [6, 138, null, null, null], [7, 164, null, 140, 0.856],
  [8, 193, 30, 171, 0.884], [9, 225, 35, 205, 0.912], [10, 260, 39, 245, 0.941], [11, 298, 44, 289, 0.97],
  [12, 339, 50, 339, 1.0], [13, 383, 55, 394, 1.029], [14, 430, 61, 455, 1.059], [15, 480, 67, 522, 1.088],
  [16, 533, 73, 596, 1.118], [17, 589, 80, 676, 1.147], [18, 648, 86, 762, 1.176], [19, 710, 93, 855, 1.205],
  [20, 775, 100, 956, 1.233], [21, 843, 107, 1063, 1.261], [22, 914, 115, 1178, 1.289], [23, 988, 122, 1301, 1.316],
  [24, 1065, 130, 1431, 1.343], [25, 1145, 137, 1568, 1.369], [26, 1227, 144, 1712, 1.395], [27, 1311, 151, 1863, 1.421],
  [28, 1397, 157, 2020, 1.446], [29, 1484, 163, 2183, 1.471], [30, 1572, 168, 2350, 1.495], [31, 1661, 172, 2523, 1.519],
  [32, 1749, 176, 2698, 1.543], [33, 1838, 180, 2878, 1.566], [34, 1928, 184, 3062, 1.589], [35, 2017, 187, 3249, 1.611],
  [36, 2106, 190, 3439, 1.633], [37, 2194, 192, 3631, 1.655], [38, 2282, 195, 3826, 1.676], [39, 2370, 197, 4022, 1.698],
  [40, 2456, 198, 4221, 1.719], [41, 2541, 200, 4420, 1.739], [42, 2626, 201, 4621, 1.76], [43, 2709, 202, 4823, 1.78],
  [44, 2791, 202, 5025, 1.801], [45, 2871, 203, 5228, 1.821], [46, 2950, 203, 5431, 1.841], [47, 3027, 204, 5635, 1.862],
  [48, 3103, 204, 5839, 1.882], [49, 3177, 204, 6043, 1.902],
];

describe('Les souches', () => {
  it('la Cobb 500 est une souche de poulet de chair : l’espèce est un attribut de la souche', () => {
    expect(cobb()).toMatchObject({ code: 'Cobb500', name: 'Cobb 500', species: 'Broiler' });
  });

  it('de J0 à J49, chaque âge porte le poids cible, la consommation journalière et cumulée et l’indice du guide', () => {
    expect(GUIDE.map(([day]) => at(day))).toEqual(
      GUIDE.map(([day, weight, dailyFeed, cumulativeFeed, feedConversion]) => ({ day, weight, dailyFeed, cumulativeFeed, feedConversion })),
    );
  });

  it('quelques âges relus contre le guide : J0 41 g ; J21 843 g, 107 g par jour, 1 063 g cumulés ; J42 2 626 g, IC 1,760 ; J49 3 177 g', () => {
    expect(at(0)?.weight).toBe(41);
    expect(at(21)).toEqual({ day: 21, weight: 843, dailyFeed: 107, cumulativeFeed: 1063, feedConversion: 1.261 });
    expect(at(42)).toMatchObject({ weight: 2626, feedConversion: 1.76 });
    expect(at(49)?.weight).toBe(3177);
  });

  it('une case vide du guide reste absente, jamais zéro : pas de consommation avant J7, pas de journalière à J7', () => {
    expect(at(3)).toEqual({ day: 3, weight: 78, dailyFeed: null, cumulativeFeed: null, feedConversion: null });
    expect(at(7)).toMatchObject({ dailyFeed: null, cumulativeFeed: 140 });
  });

  it('un âge hors de la table n’a pas de cible : ni avant la mise en place, ni après J49, ni entre deux jours', () => {
    expect([at(-1), at(50), at(120), at(2.5)]).toEqual([null, null, null, null]);
  });

  describe('la transcription se recoupe', () => {
    const rows = () => cobb().targets;

    it('un âge par jour, de J0 à J49, sans trou ni doublon ; le poids monte chaque jour', () => {
      expect(rows().map(({ day }) => day)).toEqual(Array.from({ length: 50 }, (_, day) => day));
      expect(rows().every((row, index) => index === 0 || row.weight > (rows()[index - 1]?.weight ?? Infinity))).toBe(true);
    });

    it('le cumul d’un jour est celui de la veille plus la journalière, à 1 g près (le guide arrondit)', () => {
      for (const row of rows().filter(({ dailyFeed }) => dailyFeed !== null)) {
        const previous = rows()[row.day - 1]?.cumulativeFeed ?? null;
        expect(Math.abs((row.cumulativeFeed ?? 0) - (previous ?? 0) - (row.dailyFeed ?? 0))).toBeLessThanOrEqual(1);
      }
    });

    it('l’indice du guide est le cumul divisé par le poids, au demi-centième près', () => {
      for (const row of rows().filter(({ feedConversion }) => feedConversion !== null)) {
        expect(Math.abs((row.cumulativeFeed ?? 0) / row.weight - (row.feedConversion ?? 0))).toBeLessThanOrEqual(0.005);
      }
    });
  });

  it('la table ne se modifie pas en cours de route', () => {
    expect(Object.isFrozen(STRAINS)).toBe(true);
    expect(Object.isFrozen(cobb().targets)).toBe(true);
    expect(cobb().targets.every((row) => Object.isFrozen(row))).toBe(true);
  });
});
