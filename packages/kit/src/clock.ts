/**
 * Clock port: the current instant, injected so that pure code stays clock-free and use
 * cases stay deterministic in test. `now()` returns the full instant, not just a day:
 * the same reading serves a calendar day and a timestamp.
 */
export interface Clock {
  now(): Date;
}
