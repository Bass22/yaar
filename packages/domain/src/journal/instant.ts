import { err, ok, type Brand, type Result } from '@kit';
import type { Refusal } from './refusal';

/**
 * A point in time, written in UTC to the millisecond: `2026-11-05T18:30:00.000Z`. Only this
 * spelling is accepted, so that one instant has one spelling. It is a plain string: an event
 * that carries it is stored and sent as is, and cannot be altered the way a `Date` can.
 */
export type Instant = Brand<string, 'Instant'>;

export const Instant = (raw: unknown): Result<Instant, Refusal> => {
  if (typeof raw !== 'string') {
    return err({ kind: 'InvalidInstant' });
  }
  const time = Date.parse(raw);
  // Writing the instant back must give the same text: this refuses every other spelling
  // (offset, local time, fewer digits) and what the calendar does not have (February 30th).
  return !Number.isNaN(time) && new Date(time).toISOString() === raw ? ok(raw as Instant) : err({ kind: 'InvalidInstant' });
};

/** The instant read on the clock by the caller. An invalid `Date` is a fault: it throws. */
export const instantOf = (date: Date): Instant => date.toISOString() as Instant;
