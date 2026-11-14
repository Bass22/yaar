import { err, ok, unwrap, type Clock, type Result } from '@kit';
import { Instant, instantOf, TenantId, type Role, isCanonicalUuid } from '@domain/journal';
import type { AccountAvatar, AudioLanguage, ChoosePinRefusal, ChoosePinRequest, SignInRefusal, SignInRequest, SignInResponse } from '@contracts';
import { languageOf } from '../users/account-profile';
import type { AuditAction, Prisma } from '@prisma/client';
import { recordAudit } from '../audit/audit';
import type { PrismaService } from '../database/prisma.service';
import { issueAccessToken } from './access-token';
import { Pin, typedPin } from './pin';
import { ACCOUNT_FAILURES_PER_DAY, accountRetryAt, afterFailure, DAY_MS, retryAt, type PinAttempts } from './pin-attempts';
import type { PinHash, PinHasher } from './pin-hasher';
import { SESSION_LIFETIME_SECONDS } from './session-policy';
import { E164 } from './phone';

export type SignInDependencies = {
  readonly prisma: PrismaService;
  readonly hasher: PinHasher;
  readonly clock: Clock;
  readonly jwtSecret: string;
  /** The attempts on numbers without an account, kept by this instance of the API (R-16). */
  readonly unknownNumbers: UnknownNumberAttempts;
};

/** Why an attempt waits: its device failed too often, or the account is hammered from devices it never used. */
type Wait = { readonly retryAt: Instant; readonly reason: 'TooManyAttempts' | 'TooManyFailuresOnAccount' };

/**
 * The attempts on numbers that have no account (E.10, R-16), counted exactly as on a real one —
 * per device, and per number over a day —, so that the answers never tell whether a number is
 * used. In memory: the API has one instance. Bounded: the oldest numbers go first, and a refused
 * attempt adds nothing.
 */
export class UnknownNumberAttempts {
  private readonly numbers = new Map<string, { devices: Map<string, PinAttempts>; failures: Instant[] }>();

  constructor(private readonly capacity = 10_000) {}

  /** Counts the attempt before it is checked, or says how long to wait. */
  reserve(phone: string, deviceId: string, now: Instant): Wait | null {
    const entry = this.numbers.get(phone) ?? { devices: new Map<string, PinAttempts>(), failures: [] };
    entry.failures = entry.failures.filter((at) => Date.parse(at) > Date.parse(now) - DAY_MS);
    const device = entry.devices.get(deviceId) ?? { failures: 0, lastFailureAt: null };
    const deviceWait = retryAt(device, now);
    if (deviceWait !== null) return { retryAt: deviceWait, reason: 'TooManyAttempts' };
    // No device ever signed in to a number without an account: none is spared, as on a real one.
    const accountWait = accountRetryAt(entry.failures, false, now);
    if (accountWait !== null) return { retryAt: accountWait, reason: 'TooManyFailuresOnAccount' };
    entry.devices.set(deviceId, afterFailure(device, now));
    entry.failures.push(now);
    this.numbers.delete(phone);
    this.numbers.set(phone, entry);
    if (this.numbers.size > this.capacity) this.numbers.delete(this.numbers.keys().next().value as string);
    return null;
  }
}

// An argon2id digest of a random PIN nobody knows, with the parameters of the real ones: an
// unknown number is checked against it, so that it costs the same work as a wrong PIN and the
// answer time does not tell which numbers have an account.
const NOBODY = '$argon2id$v=19$m=19456,t=2,p=1$McOFo4a2OEhSi/5pX1OxmA$ZO/TmOt7eZ0pLL82wjN8DxSHnE0kEk1BeOcvrSvIGCs' as PinHash;

type Account = {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly role: Role;
  readonly name: string;
  readonly avatar: AccountAvatar | null;
  readonly audioLanguage: AudioLanguage | null;
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
  if (!E164.test(request.phone) || !isCanonicalUuid(request.deviceId)) {
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
  if (!E164.test(request.phone) || !isCanonicalUuid(request.deviceId) || typeof request.newPin !== 'string') {
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
    const wait = deps.unknownNumbers.reserve(phone, deviceId, now);
    if (wait !== null) {
      return err({ kind: 'TooManyAttempts', retryAt: wait.retryAt });
    }
    await hasher.verify(NOBODY, pin.value);
    return err({ kind: 'InvalidCredentials' });
  }
  const tenantId = unwrap(TenantId(user.tenantId));
  // Counted before the PIN is checked (R-15): attempts sent at the same instant queue on the
  // device's row, and only the free ones get through.
  const wait = await prisma.runInTenant(tenantId, async (tx) => {
    const found = await reserveAttempt(tx, tenantId, user.id, deviceId, now);
    if (found !== null) {
      await recordAudit(tx, tenantId, { action: 'SignInRefused', actorId: user.id, subjectId: user.id, deviceId, reason: found.reason }, new Date(now));
    }
    return found;
  });
  if (wait !== null) {
    return err({ kind: 'TooManyAttempts', retryAt: wait.retryAt });
  }
  if (!(await hasher.verify(user.pinHash as PinHash, pin.value))) {
    await prisma.runInTenant(tenantId, (tx) =>
      recordAudit(tx, tenantId, { action: 'SignInFailed', actorId: user.id, subjectId: user.id, deviceId, reason: 'InvalidCredentials' }, new Date(now)),
    );
    return err({ kind: 'InvalidCredentials' });
  }
  // The right PIN: the attempt reserved was no failure, whatever the answer that follows (a
  // blocked account, a PIN to choose). Only a session makes the device known.
  await prisma.runInTenant(tenantId, (tx) => tx.signInAttempt.updateMany({ where: { userId: user.id, deviceId }, data: { failures: 0, lastFailureAt: null } }));
  return ok({ id: user.id, tenantId, role: user.role, name: user.name, avatar: user.avatar, audioLanguage: user.audioLanguage, blockedAt: user.blockedAt, provisionalPinExpiresAt: user.provisionalPinExpiresAt });
}

async function openSession(
  account: Account,
  deviceId: string,
  now: Instant,
  deps: SignInDependencies,
  change: { pinHash?: string; provisionalPinExpiresAt?: null },
  action: AuditAction,
): Promise<SignInResponse> {
  const language = await deps.prisma.runInTenant(account.tenantId, async (tx) => {
    if (Object.keys(change).length > 0) await tx.user.update({ where: { id: account.id }, data: change });
    // The device starts again from zero, and is known to the account from now on (E.10).
    await tx.$executeRaw`UPDATE sign_in_attempts SET failures = 0, last_failure_at = NULL, known_since = COALESCE(known_since, ${new Date(now)})
                          WHERE tenant_id = ${account.tenantId}::uuid AND user_id = ${account.id}::uuid AND device_id = ${deviceId}::uuid`;
    await recordAudit(tx, account.tenantId, { action, actorId: account.id, subjectId: account.id, deviceId }, new Date(now));
    return languageOf(tx, account.id, account.audioLanguage);
  });
  const token = issueAccessToken({ sub: account.id, tenant: account.tenantId, role: account.role, device: deviceId }, now, deps.jwtSecret);
  const expiresAt = instantOf(new Date(Date.parse(now) + SESSION_LIFETIME_SECONDS[account.role] * 1_000));
  // What the phone keeps to show « who holds the notebook » next time (E.9).
  return { token, expiresAt, role: account.role, account: { name: account.name, avatar: account.avatar, language } };
}

const isPast = (instant: Date, now: Instant): boolean => instant.getTime() <= Date.parse(now);

// A refusal said to someone who typed the right PIN: traced, then returned.
async function refuse<R extends { readonly kind: string }>(account: Account, deviceId: string, refusal: R, now: Instant, deps: SignInDependencies): Promise<Result<never, R>> {
  await deps.prisma.runInTenant(account.tenantId, (tx) =>
    recordAudit(tx, account.tenantId, { action: 'SignInRefused', actorId: account.id, subjectId: account.id, deviceId, reason: refusal.kind }, new Date(now)),
  );
  return err(refusal);
}

/**
 * Reserves an attempt of an account on a device (E.10): locks the device's row, says how long to
 * wait — its own failures (R-14: a device never pays for another), or, for a device the account
 * never signed in from, the failures of the whole account over a day — or counts the attempt as
 * a failure until it succeeds.
 */
async function reserveAttempt(tx: Prisma.TransactionClient, tenantId: TenantId, userId: string, deviceId: string, now: Instant): Promise<Wait | null> {
  await tx.$executeRaw`INSERT INTO sign_in_attempts (tenant_id, user_id, device_id) VALUES (${tenantId}::uuid, ${userId}::uuid, ${deviceId}::uuid) ON CONFLICT DO NOTHING`;
  const [row] = await tx.$queryRaw<{ failures: number; last_failure_at: Date | null; known_since: Date | null }[]>`
    SELECT failures, last_failure_at, known_since FROM sign_in_attempts
     WHERE tenant_id = ${tenantId}::uuid AND user_id = ${userId}::uuid AND device_id = ${deviceId}::uuid
       FOR UPDATE`;
  if (row === undefined) throw new Error('The attempt row was not written');
  const device: PinAttempts = { failures: row.failures, lastFailureAt: row.last_failure_at === null ? null : unwrap(Instant(row.last_failure_at.toISOString())) };
  const deviceWait = retryAt(device, now);
  if (deviceWait !== null) return { retryAt: deviceWait, reason: 'TooManyAttempts' };
  if (row.known_since === null) {
    const failures = await tx.auditEvent.findMany({
      where: { action: 'SignInFailed', subjectId: userId, occurredAt: { gt: new Date(Date.parse(now) - DAY_MS) } },
      select: { occurredAt: true },
      orderBy: { occurredAt: 'desc' },
      take: ACCOUNT_FAILURES_PER_DAY,
    });
    const accountWait = accountRetryAt(failures.map(({ occurredAt }) => unwrap(Instant(occurredAt.toISOString()))), false, now);
    if (accountWait !== null) return { retryAt: accountWait, reason: 'TooManyFailuresOnAccount' };
  }
  await tx.$executeRaw`UPDATE sign_in_attempts SET failures = failures + 1, last_failure_at = ${new Date(now)}
                        WHERE tenant_id = ${tenantId}::uuid AND user_id = ${userId}::uuid AND device_id = ${deviceId}::uuid`;
  return null;
}
