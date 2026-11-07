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
  | { readonly kind: 'TooManyAttempts'; readonly retryAt: string }
  /** The PIN is the provisional one the admin gave: choose one's own (POST /auth/choose-pin). */
  | { readonly kind: 'PinMustBeChosen' }
  | { readonly kind: 'ProvisionalPinExpired' };

/** First sign-in (POST /api/v1/auth/choose-pin): the provisional PIN and one's own, in one step. */
export interface ChoosePinRequest {
  readonly phone: string;
  readonly provisionalPin: string;
  readonly newPin: string;
  readonly deviceId: string;
}

export type ChoosePinRefusal =
  | SignInRefusal
  | { readonly kind: 'PinAlreadyChosen' }
  | { readonly kind: 'InvalidPin'; readonly expectedDigits: number }
  | { readonly kind: 'TrivialPin' }
  | { readonly kind: 'SameAsProvisionalPin' };

/** What the admin sends to create an account of the team (POST /api/v1/users). */
export interface CreateAccountRequest {
  /** UUID made by the caller. */
  readonly id: string;
  readonly phone: string;
  readonly name: string;
}

/** The provisional PIN, shown once to the admin, who hands it over in person. */
export interface ProvisionalPin {
  readonly provisionalPin: string;
  readonly provisionalPinExpiresAt: string;
}
