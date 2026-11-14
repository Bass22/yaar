import { createHmac, timingSafeEqual } from 'node:crypto';
import { err, ok, type Brand, type Result } from '@kit';
import type { Instant, Role } from '@domain/journal';
import { SESSION_LIFETIME_SECONDS } from './session-policy';
import { isCanonicalUuid } from '@domain/journal';

/** What a session token says, and nothing more: no phone, no name, no site. */
export type SessionClaims = {
  /** The user (UUID). */
  readonly sub: string;
  /** The tenant (UUID): the one every request of the session runs under. */
  readonly tenant: string;
  readonly role: Role;
  /** The device the session was opened on (UUID made by the device). */
  readonly device: string;
  /** Issued at, seconds since the epoch. */
  readonly iat: number;
  /** Expires at, seconds since the epoch: refused from that second on. */
  readonly exp: number;
};

export type AccessToken = Brand<string, 'AccessToken'>;

export type TokenRefusal = { readonly kind: 'TokenInvalid' } | { readonly kind: 'TokenExpired' };

// A compact JWT, signed with HMAC-SHA256 and nothing else: the API issues every token it
// verifies, so the header is a constant — a token with any other header is not one of ours,
// whatever it claims (no "none", no other algorithm, no key confusion).
const HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
const LONGEST_TOKEN = 2_048;
const ROLES: readonly Role[] = ['admin', 'collaborator'];

const sign = (signingInput: string, secret: string): string => createHmac('sha256', secret).update(signingInput).digest('base64url');
const seconds = (instant: Instant): number => Math.floor(Date.parse(instant) / 1_000);

export const issueAccessToken = (session: Omit<SessionClaims, 'iat' | 'exp'>, now: Instant, secret: string): AccessToken => {
  const iat = seconds(now);
  const claims: SessionClaims = { sub: session.sub, tenant: session.tenant, role: session.role, device: session.device, iat, exp: iat + SESSION_LIFETIME_SECONDS[session.role] };
  const signingInput = `${HEADER}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
  return `${signingInput}.${sign(signingInput, secret)}` as AccessToken;
};

/** The signature is checked before anything is read from the token; the clock is the caller's. */
export const verifyAccessToken = (token: string, now: Instant, secret: string): Result<SessionClaims, TokenRefusal> => {
  if (typeof token !== 'string' || token.length > LONGEST_TOKEN) {
    return err({ kind: 'TokenInvalid' });
  }
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== HEADER) {
    return err({ kind: 'TokenInvalid' });
  }
  const [header, payload, signature] = parts as [string, string, string];
  const expected = Buffer.from(sign(`${header}.${payload}`, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return err({ kind: 'TokenInvalid' });
  }
  const claims = claimsOf(payload);
  if (claims === null) {
    return err({ kind: 'TokenInvalid' });
  }
  if (claims.exp <= seconds(now)) {
    return err({ kind: 'TokenExpired' });
  }
  return ok(claims);
};

// The exact shape, and only it: an extra field, a missing one or a wrong type is refused.
function claimsOf(payload: string): SessionClaims | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Object.keys(parsed).length !== 6) {
    return null;
  }
  const { sub, tenant, role, device, iat, exp } = parsed as Record<string, unknown>;
  const isUuid = (value: unknown): value is string => typeof value === 'string' && isCanonicalUuid(value);
  const isSeconds = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  if (!isUuid(sub) || !isUuid(tenant) || !isUuid(device) || !ROLES.includes(role as Role) || !isSeconds(iat) || !isSeconds(exp)) {
    return null;
  }
  return { sub, tenant, role: role as Role, device, iat, exp };
}
