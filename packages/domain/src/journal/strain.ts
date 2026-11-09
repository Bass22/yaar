import type { Weight } from './weight';

/** The kind of animal. A strain carries it; the journal never does (other species: V2). */
export type Species = 'Broiler';

/** What the publisher's guide expects of one bird at one age. Grams per bird; `null`: not given by the guide. */
export interface StrainTarget {
  /** Age in days, placement being day 0. */
  readonly day: number;
  readonly weight: Weight;
  readonly dailyFeed: Weight | null;
  readonly cumulativeFeed: Weight | null;
  /** Cumulative feed conversion as printed by the guide, not recomputed. */
  readonly feedConversion: number | null;
}

export interface Strain {
  readonly code: 'Cobb500';
  readonly name: string;
  readonly species: Species;
  /** One row per day, from day 0, without gaps. */
  readonly targets: readonly StrainTarget[];
}

type GuideRow = readonly [weight: number, dailyFeed: number | null, cumulativeFeed: number | null, feedConversion: number | null];

const grams = (value: number | null): Weight | null => (value === null ? null : (value as Weight));

const strain = (code: Strain['code'], name: string, species: Species, guide: readonly GuideRow[]): Strain =>
  Object.freeze({
    code,
    name,
    species,
    targets: Object.freeze(
      guide.map(([weight, dailyFeed, cumulativeFeed, feedConversion], day) =>
        Object.freeze({ day, weight: weight as Weight, dailyFeed: grams(dailyFeed), cumulativeFeed: grams(cumulativeFeed), feedConversion }),
      ),
    ),
  });

// « Cobb 500 Performances et Recommandations Nutritionnelles », as-hatched column, day 0 to 49:
// weight, daily feed, cumulative feed (grams per bird), cumulative feed conversion.
// prettier-ignore
const COBB_500: readonly GuideRow[] = [
  [41, null, null, null], [52, null, null, null], [64, null, null, null], [78, null, null, null],
  [95, null, null, null], [115, null, null, null], [138, null, null, null], [164, null, 140, 0.856],
  [193, 30, 171, 0.884], [225, 35, 205, 0.912], [260, 39, 245, 0.941], [298, 44, 289, 0.97],
  [339, 50, 339, 1.0], [383, 55, 394, 1.029], [430, 61, 455, 1.059], [480, 67, 522, 1.088],
  [533, 73, 596, 1.118], [589, 80, 676, 1.147], [648, 86, 762, 1.176], [710, 93, 855, 1.205],
  [775, 100, 956, 1.233], [843, 107, 1063, 1.261], [914, 115, 1178, 1.289], [988, 122, 1301, 1.316],
  [1065, 130, 1431, 1.343], [1145, 137, 1568, 1.369], [1227, 144, 1712, 1.395], [1311, 151, 1863, 1.421],
  [1397, 157, 2020, 1.446], [1484, 163, 2183, 1.471], [1572, 168, 2350, 1.495], [1661, 172, 2523, 1.519],
  [1749, 176, 2698, 1.543], [1838, 180, 2878, 1.566], [1928, 184, 3062, 1.589], [2017, 187, 3249, 1.611],
  [2106, 190, 3439, 1.633], [2194, 192, 3631, 1.655], [2282, 195, 3826, 1.676], [2370, 197, 4022, 1.698],
  [2456, 198, 4221, 1.719], [2541, 200, 4420, 1.739], [2626, 201, 4621, 1.76], [2709, 202, 4823, 1.78],
  [2791, 202, 5025, 1.801], [2871, 203, 5228, 1.821], [2950, 203, 5431, 1.841], [3027, 204, 5635, 1.862],
  [3103, 204, 5839, 1.882], [3177, 204, 6043, 1.902],
];

/** The publisher's strains: the same for every farm, changed only by a release. */
export const STRAINS: readonly Strain[] = Object.freeze([strain('Cobb500', 'Cobb 500', 'Broiler', COBB_500)]);

/** The guide's target at a campaign day; `null` outside the table — never a zero. */
export const targetAt = (strain: Strain, day: number): StrainTarget | null => (Number.isInteger(day) ? (strain.targets[day] ?? null) : null);
