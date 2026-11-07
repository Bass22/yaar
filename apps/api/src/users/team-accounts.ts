import { randomInt } from 'node:crypto';
import { err, ok, type Result } from '@kit';
import type { Prisma } from '@prisma/client';
import type { CreateAccountRequest, ProvisionalPin } from '@contracts';
import { recordAudit } from '../audit/audit';
import { Pin } from '../auth/pin';
import type { PinHasher } from '../auth/pin-hasher';
import type { Session } from '../auth/session';
import { PROVISIONAL_PIN_LIFETIME_SECONDS } from '../auth/session-policy';
import type { PrismaService } from '../database/prisma.service';

export type TeamAccountRefusal =
  | { readonly kind: 'InvalidRequest' }
  | { readonly kind: 'PhoneAlreadyUsed' }
  | { readonly kind: 'AccountNotFound' }
  | { readonly kind: 'OnlyCollaboratorsGetProvisionalPins' };

const E164 = /^\+[1-9][0-9]{7,14}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A random four-digit PIN that passes the rules of a new PIN: the admin hands it over in person. */
export function drawProvisionalPin(): Pin {
  for (;;) {
    const pin = Pin(String(randomInt(0, 10_000)).padStart(4, '0'), 'collaborator');
    if (pin.ok) {
      return pin.value;
    }
  }
}

const expiryFrom = (now: Date): Date => new Date(now.getTime() + PROVISIONAL_PIN_LIFETIME_SECONDS * 1_000);

/**
 * Creates an account of the team: always a collaborator — the request chooses neither the role
 * nor the PIN. It gets a provisional PIN, shown once in the answer and valid seven days. The
 * phone number is checked across the whole service first (one account per number).
 */
export async function createAccount(
  tx: Prisma.TransactionClient,
  deps: { readonly prisma: PrismaService; readonly hasher: PinHasher },
  admin: Session,
  request: CreateAccountRequest,
  now: Date,
): Promise<Result<{ readonly id: string; readonly role: 'collaborator' } & ProvisionalPin, TeamAccountRefusal>> {
  const name = request.name.trim();
  if (!UUID.test(request.id) || !E164.test(request.phone) || name === '') {
    return err({ kind: 'InvalidRequest' });
  }
  if ((await deps.prisma.findUserForSignIn(request.phone)) !== null) {
    return err({ kind: 'PhoneAlreadyUsed' });
  }
  const pin = drawProvisionalPin();
  const provisionalPinExpiresAt = expiryFrom(now);
  await tx.user.create({
    data: { id: request.id, tenantId: admin.tenantId, phone: request.phone, name, role: 'collaborator', pinHash: await deps.hasher.hash(pin), provisionalPinExpiresAt },
  });
  await recordAudit(tx, admin.tenantId, { action: 'AccountCreated', actorId: admin.userId, subjectId: request.id, deviceId: admin.deviceId }, now);
  return ok({ id: request.id, role: 'collaborator', provisionalPin: pin.reveal(), provisionalPinExpiresAt: provisionalPinExpiresAt.toISOString() });
}

/**
 * A forgotten PIN: the admin gives a new provisional one. The former PIN stops working, every
 * token issued so far too, and the next sign-in chooses a PIN again. Collaborators only.
 */
export async function resetPin(tx: Prisma.TransactionClient, hasher: PinHasher, admin: Session, userId: string, now: Date): Promise<Result<ProvisionalPin, TeamAccountRefusal>> {
  const target = UUID.test(userId) ? await tx.user.findUnique({ where: { id: userId }, select: { id: true, role: true } }) : null;
  if (target === null) {
    return err({ kind: 'AccountNotFound' });
  }
  if (target.role !== 'collaborator') {
    return err({ kind: 'OnlyCollaboratorsGetProvisionalPins' });
  }
  const pin = drawProvisionalPin();
  const provisionalPinExpiresAt = expiryFrom(now);
  await tx.user.update({
    where: { id: target.id },
    data: { pinHash: await hasher.hash(pin), provisionalPinExpiresAt, sessionsValidFrom: now, pinFailures: 0, pinLastFailureAt: null },
  });
  await recordAudit(tx, admin.tenantId, { action: 'PinReset', actorId: admin.userId, subjectId: target.id, deviceId: admin.deviceId }, now);
  return ok({ provisionalPin: pin.reveal(), provisionalPinExpiresAt: provisionalPinExpiresAt.toISOString() });
}
