import { err, ok, unwrap, type Clock, type Result } from '@kit';
import { Instant, instantOf, TenantId } from '@domain/journal';
import type { SignInRefusal, SignInRequest, SignInResponse } from '@contracts';
import type { PrismaService } from '../database/prisma.service';
import { issueAccessToken } from './access-token';
import { typedPin } from './pin';
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

/**
 * Opens a session from a phone number and a PIN. An unknown number and a wrong PIN get the
 * same answer after the same work. While the wait after failed attempts runs, the PIN is not
 * checked and the attempt does not count. A blocked account is only said blocked to whoever
 * typed its PIN. Every instant is the server's.
 */
export async function signIn(request: SignInRequest, deps: SignInDependencies): Promise<Result<SignInResponse, SignInRefusal>> {
  const { prisma, hasher, clock, jwtSecret } = deps;
  const pin = typedPin(request.pin);
  if (!pin.ok || !E164.test(request.phone) || !UUID.test(request.deviceId)) {
    return err({ kind: 'InvalidRequest' });
  }
  const now = instantOf(clock.now());

  const user = await prisma.findUserForSignIn(request.phone);
  if (user === null) {
    await hasher.verify(NOBODY, pin.value);
    return err({ kind: 'InvalidCredentials' });
  }

  const lastFailureAt = user.pinLastFailureAt === null ? null : unwrap(Instant(user.pinLastFailureAt.toISOString()));
  const attempts = { failures: user.pinFailures, lastFailureAt };
  const waitUntil = retryAt(attempts, now);
  if (waitUntil !== null) {
    return err({ kind: 'TooManyAttempts', retryAt: waitUntil });
  }

  const tenantId = unwrap(TenantId(user.tenantId));
  if (!(await hasher.verify(user.pinHash as PinHash, pin.value))) {
    const next = afterFailure(attempts, now);
    await prisma.runInTenant(tenantId, (tx) =>
      tx.user.update({ where: { id: user.id }, data: { pinFailures: { increment: 1 }, pinLastFailureAt: new Date(next.lastFailureAt ?? now) } }),
    );
    return err({ kind: 'InvalidCredentials' });
  }
  if (user.blockedAt !== null) {
    return err({ kind: 'AccountBlocked' });
  }

  await prisma.runInTenant(tenantId, (tx) => tx.user.update({ where: { id: user.id }, data: { pinFailures: 0, pinLastFailureAt: null } }));
  const token = issueAccessToken({ sub: user.id, tenant: user.tenantId, role: user.role, device: request.deviceId }, now, jwtSecret);
  const expiresAt = instantOf(new Date(Date.parse(now) + SESSION_LIFETIME_SECONDS[user.role] * 1_000));
  return ok({ token, expiresAt, role: user.role });
}
