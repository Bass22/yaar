import { err, ok, unwrap, type Clock, type Result } from '@kit';
import { Instant, instantOf, TenantId, type Role } from '@domain/journal';
import type { ChoosePinRefusal, ChoosePinRequest, SignInRefusal, SignInRequest, SignInResponse } from '@contracts';
import type { AuditAction } from '@prisma/client';
import { recordAudit } from '../audit/audit';
import type { PrismaService } from '../database/prisma.service';
import { issueAccessToken } from './access-token';
import { Pin, typedPin } from './pin';
import { afterFailure, retryAt } from './pin-attempts';
import type { PinHash, PinHasher } from './pin-hasher';
import { SESSION_LIFETIME_SECONDS } from './session-policy';

export type SignInDependencies = {
  readonly prisma: PrismaService;
  readonly hasher: PinHasher;
  readonly clock: Clock;
  readonly jwtSecret: string;
};

const E164 = /^\+[1-9][0-9]{7,14}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// An argon2id digest of a random PIN nobody knows, with the parameters of the real ones: an
// unknown number is checked against it, so that it costs the same work as a wrong PIN and the
// answer time does not tell which numbers have an account.
const NOBODY = '$argon2id$v=19$m=19456,t=2,p=1$McOFo4a2OEhSi/5pX1OxmA$ZO/TmOt7eZ0pLL82wjN8DxSHnE0kEk1BeOcvrSvIGCs' as PinHash;

type Account = {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly role: Role;
  readonly blockedAt: Date | null;
  readonly provisionalPinExpiresAt: Date | null;
};

/**
 * Opens a session from a phone number and a PIN. An unknown number and a wrong PIN get the
 * same answer after the same work. While the wait after failed attempts runs, the PIN is not
 * checked and the attempt does not count. A blocked account, or a PIN that is still the
 * provisional one, is only said so to whoever typed it. Every instant is the server's.
 */
export async function signIn(request: SignInRequest, deps: SignInDependencies): Promise<Result<SignInResponse, SignInRefusal>> {
  if (!E164.test(request.phone) || !UUID.test(request.deviceId)) {
    return err({ kind: 'InvalidRequest' });
  }
  const now = instantOf(deps.clock.now());
  const checked = await checkCredentials(request.phone, request.pin, request.deviceId, now, deps);
  if (!checked.ok) {
    return checked;
  }
  const account = checked.value;
  if (account.blockedAt !== null) {
    return refuse(account, request.deviceId, { kind: 'AccountBlocked' }, now, deps);
  }
  if (account.provisionalPinExpiresAt !== null) {
    return refuse(account, request.deviceId, { kind: isPast(account.provisionalPinExpiresAt, now) ? 'ProvisionalPinExpired' : 'PinMustBeChosen' }, now, deps);
  }
  return ok(await openSession(account, request.deviceId, now, deps, {}, 'SignInSucceeded'));
}

/**
 * First sign-in of an account created by the admin: the provisional PIN, which the admin knows,
 * and one's own, in one step — no session exists before one's own PIN is chosen, so the admin
 * cannot sign in in the collaborator's place. Counted like any sign-in.
 */
export async function choosePin(request: ChoosePinRequest, deps: SignInDependencies): Promise<Result<SignInResponse, ChoosePinRefusal>> {
  if (!E164.test(request.phone) || !UUID.test(request.deviceId) || typeof request.newPin !== 'string') {
    return err({ kind: 'InvalidRequest' });
  }
  const now = instantOf(deps.clock.now());
  const checked = await checkCredentials(request.phone, request.provisionalPin, request.deviceId, now, deps);
  if (!checked.ok) {
    return checked;
  }
  const account = checked.value;
  if (account.blockedAt !== null) {
    return refuse(account, request.deviceId, { kind: 'AccountBlocked' }, now, deps);
  }
  if (account.provisionalPinExpiresAt === null) {
    return refuse(account, request.deviceId, { kind: 'PinAlreadyChosen' }, now, deps);
  }
  if (isPast(account.provisionalPinExpiresAt, now)) {
    return refuse(account, request.deviceId, { kind: 'ProvisionalPinExpired' }, now, deps);
  }
  const newPin = Pin(request.newPin, account.role);
  if (!newPin.ok) {
    return newPin;
  }
  if (request.newPin === request.provisionalPin) {
    return err({ kind: 'SameAsProvisionalPin' });
  }
  const pinHash = await deps.hasher.hash(newPin.value);
  return ok(await openSession(account, request.deviceId, now, deps, { pinHash, provisionalPinExpiresAt: null }, 'PinChosen'));
}

// Finds the account and checks the PIN typed against its digest, counting failures. Shared by
// both ways in, so that the provisional PIN is guarded exactly like any other.
async function checkCredentials(phone: string, rawPin: string, deviceId: string, now: Instant, deps: SignInDependencies): Promise<Result<Account, SignInRefusal>> {
  const { prisma, hasher } = deps;
  const pin = typedPin(rawPin);
  if (!pin.ok) {
    return err({ kind: 'InvalidRequest' });
  }
  const user = await prisma.findUserForSignIn(phone);
  if (user === null) {
    await hasher.verify(NOBODY, pin.value);
    return err({ kind: 'InvalidCredentials' });
  }
  const lastFailureAt = user.pinLastFailureAt === null ? null : unwrap(Instant(user.pinLastFailureAt.toISOString()));
  const attempts = { failures: user.pinFailures, lastFailureAt };
  const waitUntil = retryAt(attempts, now);
  const tenantId = unwrap(TenantId(user.tenantId));
  if (waitUntil !== null) {
    await prisma.runInTenant(tenantId, (tx) =>
      recordAudit(tx, tenantId, { action: 'SignInRefused', actorId: user.id, subjectId: user.id, deviceId, reason: 'TooManyAttempts' }, new Date(now)),
    );
    return err({ kind: 'TooManyAttempts', retryAt: waitUntil });
  }
  if (!(await hasher.verify(user.pinHash as PinHash, pin.value))) {
    const next = afterFailure(attempts, now);
    await prisma.runInTenant(tenantId, async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { pinFailures: { increment: 1 }, pinLastFailureAt: new Date(next.lastFailureAt ?? now) } });
      await recordAudit(tx, tenantId, { action: 'SignInFailed', actorId: user.id, subjectId: user.id, deviceId, reason: 'InvalidCredentials' }, new Date(now));
    });
    return err({ kind: 'InvalidCredentials' });
  }
  return ok({ id: user.id, tenantId, role: user.role, blockedAt: user.blockedAt, provisionalPinExpiresAt: user.provisionalPinExpiresAt });
}

async function openSession(
  account: Account,
  deviceId: string,
  now: Instant,
  deps: SignInDependencies,
  change: { pinHash?: string; provisionalPinExpiresAt?: null },
  action: AuditAction,
): Promise<SignInResponse> {
  await deps.prisma.runInTenant(account.tenantId, async (tx) => {
    await tx.user.update({ where: { id: account.id }, data: { pinFailures: 0, pinLastFailureAt: null, ...change } });
    await recordAudit(tx, account.tenantId, { action, actorId: account.id, subjectId: account.id, deviceId }, new Date(now));
  });
  const token = issueAccessToken({ sub: account.id, tenant: account.tenantId, role: account.role, device: deviceId }, now, deps.jwtSecret);
  const expiresAt = instantOf(new Date(Date.parse(now) + SESSION_LIFETIME_SECONDS[account.role] * 1_000));
  return { token, expiresAt, role: account.role };
}

const isPast = (instant: Date, now: Instant): boolean => instant.getTime() <= Date.parse(now);

// A refusal said to someone who typed the right PIN: traced, then returned.
async function refuse<R extends { readonly kind: string }>(account: Account, deviceId: string, refusal: R, now: Instant, deps: SignInDependencies): Promise<Result<never, R>> {
  await deps.prisma.runInTenant(account.tenantId, (tx) =>
    recordAudit(tx, account.tenantId, { action: 'SignInRefused', actorId: account.id, subjectId: account.id, deviceId, reason: refusal.kind }, new Date(now)),
  );
  return err(refusal);
}
