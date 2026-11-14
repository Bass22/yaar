import { instantOf, type Instant } from '@domain/journal';

/** The failed PIN attempts in a row since the last successful sign-in. */
export type PinAttempts = { readonly failures: number; readonly lastFailureAt: Instant | null };

export const NO_FAILURE: PinAttempts = Object.freeze({ failures: 0, lastFailureAt: null });

// Three free attempts, then a wait that grows up to one hour and never becomes a lock-out:
// anyone can hammer a phone number, and a caretaker must not be shut out for good by it.
const FREE_ATTEMPTS = 3;
const WAIT_SECONDS = [30, 60, 300, 900, 3_600] as const;
const LONGEST_WAIT_SECONDS = 3_600;

/**
 * When the next attempt may be made, `null` when it may be made now. The caller checks this
 * before reading the typed PIN: an attempt refused here is not checked, and is not counted.
 * In doubt it waits: failures without the date of the last one wait from now, and a counter
 * that cannot be read waits the longest.
 */
export const retryAt = (attempts: PinAttempts, now: Instant): Instant | null => {
  if (attempts.failures < FREE_ATTEMPTS) {
    return null;
  }
  const wait = WAIT_SECONDS[attempts.failures - FREE_ATTEMPTS] ?? LONGEST_WAIT_SECONDS;
  const allowedAt = instantOf(new Date(Date.parse(attempts.lastFailureAt ?? now) + wait * 1_000));
  // Instants are written the same way: they compare as texts.
  return now < allowedAt ? allowedAt : null;
};

export const afterFailure = (attempts: PinAttempts, failedAt: Instant): PinAttempts => ({
  failures: attempts.failures + 1,
  lastFailureAt: failedAt,
});

export const afterSuccess = (): PinAttempts => NO_FAILURE;

/** Failures on one account, all devices together, beyond which a device it never used waits (E.10). */
export const ACCOUNT_FAILURES_PER_DAY = 20;
/** The window of the account's failures (R-14, R-16): sign-in and the attempts count over the same 24 hours. */
export const DAY_MS = 24 * 3_600 * 1_000;

/**
 * The wait of a device on an account under attack (R-14, decision of 2026-11-13): a device the
 * account already signed in from is never slowed by the failures of others; any other one, once
 * the account has 20 failures in the last 24 hours, waits until the oldest of those 20 is a day old.
 */
export const accountRetryAt = (failures: readonly Instant[], knownDevice: boolean, now: Instant): Instant | null => {
  if (knownDevice) return null;
  const since = Date.parse(now) - DAY_MS;
  const recent = failures.filter((at) => Date.parse(at) > since).sort();
  if (recent.length < ACCOUNT_FAILURES_PER_DAY) return null;
  const oldestOfTheLast = recent[recent.length - ACCOUNT_FAILURES_PER_DAY] as Instant;
  const allowedAt = instantOf(new Date(Date.parse(oldestOfTheLast) + DAY_MS));
  return now < allowedAt ? allowedAt : null;
};
