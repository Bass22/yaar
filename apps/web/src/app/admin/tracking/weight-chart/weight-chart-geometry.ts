import type { Strain } from '@domain/journal';

/** A validated weighing on the curve: its day of the flock and its average, in grams. */
export interface ChartWeighing {
  readonly campaignDay: number;
  readonly average: number;
}

/** What the weight chart draws (V.2), in the units of its 320 × 180 drawing, to the tenth. */
export interface WeightChart {
  /** One tick a week, J7 to the last day shown. */
  readonly days: readonly { readonly x: number; readonly label: string }[];
  /** One line per whole kilo, up to the kilo above the heaviest weight shown. */
  readonly kilos: readonly { readonly y: number; readonly label: string }[];
  /** The strain's target day by day, while its table gives one; `null` without a known strain. */
  readonly target: string | null;
  /** The validated weighings joined, from two on; `null` before. */
  readonly real: string | null;
  readonly points: readonly ({ readonly x: number; readonly y: number } & ChartWeighing)[];
  /** The latest weighing's average, written beside its point — on its left near the right edge. */
  readonly last: { readonly x: number; readonly y: number; readonly anchor: 'start' | 'end'; readonly label: string } | null;
}

const LEFT = 28;
const RIGHT = 310;
const BOTTOM = 158;
const TOP = 12;
/** The days shown at least: the notebook's gauge (CdC, decision of 2026-11-09). */
const DAYS_SHOWN = 42;
const WEEK = 7;
/** Past this, the average is written on the left of its point, to stay in the drawing. */
const LABEL_FLIP_X = 250;

const tenth = (value: number): number => Math.round(value * 10) / 10;
const grams = (value: number): string => `${String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} g`;
const pathOf = (points: readonly (readonly [number, number])[]): string => `M${points.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L')}`;

/**
 * The geometry of the weight chart (V.2; CdC « Le graphe du poids », after bureau-admin.html): the
 * days from J0 to J42, or to the whole week past the latest weighing; the kilos up to the kilo above
 * the heaviest weight shown; the strain's target, dashed; the validated weighings, joined.
 */
export function weightChart(curve: readonly ChartWeighing[], strain: Strain | null): WeightChart {
  const weighings = [...curve].sort((a, b) => a.campaignDay - b.campaignDay);
  const lastDay = Math.max(DAYS_SHOWN, ...weighings.map(({ campaignDay }) => campaignDay));
  const dayMax = Math.ceil(lastDay / WEEK) * WEEK;
  const targets = (strain?.targets ?? []).filter(({ day }) => day <= dayMax);
  const heaviest = Math.max(1, ...targets.map(({ weight }) => weight), ...weighings.map(({ average }) => average));
  const kiloMax = Math.ceil(heaviest / 1000);

  const x = (day: number): number => LEFT + (day / dayMax) * (RIGHT - LEFT);
  const y = (weight: number): number => BOTTOM - (weight / (kiloMax * 1000)) * (BOTTOM - TOP);

  const points = weighings.map((weighing) => ({ x: tenth(x(weighing.campaignDay)), y: tenth(y(weighing.average)), ...weighing }));
  const latest = points.at(-1);
  return {
    days: Array.from({ length: dayMax / WEEK }, (_, week) => ({ x: tenth(x((week + 1) * WEEK)), label: `J${(week + 1) * WEEK}` })),
    kilos: Array.from({ length: kiloMax }, (_, kilo) => ({ y: tenth(y((kilo + 1) * 1000)), label: String(kilo + 1) })),
    target: targets.length === 0 ? null : pathOf(targets.map(({ day, weight }) => [x(day), y(weight)])),
    real: points.length < 2 ? null : pathOf(points.map((point) => [point.x, point.y])),
    points: points.map(({ x, y, campaignDay, average }) => ({ x, y, campaignDay, average })),
    last: latest === undefined ? null : { x: latest.x, y: latest.y, anchor: latest.x > LABEL_FLIP_X ? 'end' : 'start', label: grams(latest.average) },
  };
}
