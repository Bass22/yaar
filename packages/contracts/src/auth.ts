// Contract of the sign-in route (POST /api/v1/auth/sign-in). Types only: the API checks every
// field at its border, the PWA builds the request from them.

/** What the device sends. The PIN travels once, over TLS, and is never stored on the server. */
export interface SignInRequest {
  /** E.164, for example +221771234567. */
  readonly phone: string;
  readonly pin: string;
  /** Created once on the device (UUID): it names the device in the session and in the audit. */
  readonly deviceId: string;
}

export type SessionRole = 'admin' | 'collaborator';

/** A session opened: the token to send as `Authorization: Bearer …`, until `expiresAt`. */
export interface SignInResponse {
  readonly token: string;
  /** Instant, universal time. */
  readonly expiresAt: string;
  readonly role: SessionRole;
}

/**
 * Why a sign-in was refused. `InvalidCredentials` covers an unknown number as well as a wrong
 * PIN, on purpose. `TooManyAttempts` says when the next attempt is allowed.
 */
export type SignInRefusal =
  | { readonly kind: 'InvalidRequest' }
  | { readonly kind: 'InvalidCredentials' }
  | { readonly kind: 'AccountBlocked' }
  | { readonly kind: 'TooManyAttempts'; readonly retryAt: string };
