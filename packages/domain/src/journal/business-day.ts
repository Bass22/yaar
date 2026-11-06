import { err, ok, type Brand, type Result } from '@kit';
import type { Refusal } from './refusal';

/**
 * A business day: a calendar date with no time, written `YYYY-MM-DD`, as lived on the
 * site. It is the day a declaration is *about* (chosen), as opposed to the instant it
 * was recorded (automatic). Being a plain string, it is stored and sent as is, and two
 * business days compare with `<` and `===`.
 */
export type BusinessDay = Brand<string, 'BusinessDay'>;

/** The IANA time zone of a site (`Africa/Dakar`): where its day starts and ends. */
export type TimeZone = Brand<string, 'TimeZone'>;

export type RecentBusinessDays = {
  readonly today: BusinessDay;
  readonly yesterday: BusinessDay;
  readonly dayBeforeYesterday: BusinessDay;
};

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

// UTC arithmetic on calendar days: deterministic date math, never a reading of the clock.
const dayOfOrdinal = (ordinal: number): BusinessDay => new Date(ordinal).toISOString().slice(0, 10) as BusinessDay;

const ordinalOf = (day: BusinessDay): number =>
  Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));

export const BusinessDay = (raw: unknown): Result<BusinessDay, Refusal> => {
  const match = typeof raw === 'string' ? ISO_DAY.exec(raw) : null;
  if (!match) {
    return err({ kind: 'InvalidBusinessDay' });
  }
  // Round-trip through UTC to reject impossible dates (2026-02-30 would roll over to March).
  const ordinal = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return dayOfOrdinal(ordinal) === raw ? ok(raw as BusinessDay) : err({ kind: 'InvalidBusinessDay' });
};

export const TimeZone = (raw: unknown): Result<TimeZone, Refusal> => {
  if (typeof raw !== 'string' || raw === '') {
    return err({ kind: 'InvalidTimeZone' });
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: raw });
    return ok(raw as TimeZone);
  } catch {
    return err({ kind: 'InvalidTimeZone' });
  }
};

/** The business day an instant falls on, in the time zone of the site. */
export const businessDayAt = (instant: Date, timeZone: TimeZone): BusinessDay => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const read = (type: 'year' | 'month' | 'day'): string => parts.find((part) => part.type === type)?.value ?? '';

  return `${read('year').padStart(4, '0')}-${read('month')}-${read('day')}` as BusinessDay;
};

export const addDays = (day: BusinessDay, count: number): BusinessDay =>
  dayOfOrdinal(ordinalOf(day) + count * MS_PER_DAY);

/**
 * Day J of a campaign: the number of days since the birds were placed. The placement
 * day is J0. The result is signed: a day before the placement is negative, never clamped.
 */
export const campaignDay = (placementDay: BusinessDay, businessDay: BusinessDay): number =>
  Math.round((ordinalOf(businessDay) - ordinalOf(placementDay)) / MS_PER_DAY);

/** The three days a caretaker can write for, derived from the instant given by the clock. */
export const recentBusinessDays = (now: Date, timeZone: TimeZone): RecentBusinessDays => {
  const today = businessDayAt(now, timeZone);

  return { today, yesterday: addDays(today, -1), dayBeforeYesterday: addDays(today, -2) };
};
