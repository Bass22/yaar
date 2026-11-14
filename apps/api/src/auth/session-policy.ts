import type { Role } from '@domain/journal';

/** How long a provisional PIN, given by the admin, can be used to choose one's own (decision of 2026-11-07). */
export const PROVISIONAL_PIN_LIFETIME_SECONDS = 7 * 24 * 3_600;

/**
 * How long a session lasts, by role, in seconds (decision of 2026-11-07). No renewal: when
 * it ends, the PIN is asked again — which also keeps it in memory. A caretaker signs in once
 * a week; the admin, who sees the money, once a day. Change here, nowhere else.
 */
export const SESSION_LIFETIME_SECONDS: Readonly<Record<Role, number>> = Object.freeze({
  collaborator: 7 * 24 * 3_600,
  admin: 24 * 3_600,
});
