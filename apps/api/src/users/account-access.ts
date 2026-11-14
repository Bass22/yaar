import { err, ok, type Result } from '@kit';
import type { Prisma } from '@prisma/client';
import { recordAudit } from '../audit/audit';
import type { Session } from '../auth/session';
import { unsubscribeAccount } from '../notifications/push-subscription';
import { isCanonicalUuid } from '@domain/journal';

export type AccountAccessRefusal =
  | { readonly kind: 'AccountNotFound' }
  | { readonly kind: 'CannotBlockOwnAccount' }
  | { readonly kind: 'OnlyCollaboratorsCanBeBlocked' };

// Read in the tenant transaction of the request: an account of another tenant does not exist.
async function targetOf(tx: Prisma.TransactionClient, userId: string) {
  return isCanonicalUuid(userId) ? tx.user.findUnique({ where: { id: userId }, select: { id: true, role: true, blockedAt: true } }) : null;
}

/**
 * Blocks an account of the team (a stolen phone): every token issued so far stops working at
 * the next request, on every device, and sign-in is refused. The admin blocks collaborators
 * only — neither their own account nor another admin's. Blocking twice keeps the first date.
 */
export async function blockAccount(tx: Prisma.TransactionClient, admin: Session, userId: string, now: Date): Promise<Result<void, AccountAccessRefusal>> {
  const target = await targetOf(tx, userId);
  if (target === null) {
    return err({ kind: 'AccountNotFound' });
  }
  if (target.id === admin.userId) {
    return err({ kind: 'CannotBlockOwnAccount' });
  }
  if (target.role !== 'collaborator') {
    return err({ kind: 'OnlyCollaboratorsCanBeBlocked' });
  }
  await tx.user.update({ where: { id: target.id }, data: { blockedAt: target.blockedAt ?? now, sessionsValidFrom: now } });
  await unsubscribeAccount(tx, target.id);
  await recordAudit(tx, admin.tenantId, { action: 'AccountBlocked', actorId: admin.userId, subjectId: target.id, deviceId: admin.deviceId }, now);
  return ok(undefined);
}

/** Lifts a block. The tokens issued before stay refused: the account signs in again. */
export async function unblockAccount(tx: Prisma.TransactionClient, admin: Session, userId: string, now: Date): Promise<Result<void, AccountAccessRefusal>> {
  const target = await targetOf(tx, userId);
  if (target === null) {
    return err({ kind: 'AccountNotFound' });
  }
  await tx.user.update({ where: { id: target.id }, data: { blockedAt: null } });
  await recordAudit(tx, admin.tenantId, { action: 'AccountUnblocked', actorId: admin.userId, subjectId: target.id, deviceId: admin.deviceId }, now);
  return ok(undefined);
}

/** Every token issued so far stops working; the account is not blocked and signs in again. */
export async function signOutEverywhere(tx: Prisma.TransactionClient, actor: Session, userId: string, now: Date): Promise<Result<void, AccountAccessRefusal>> {
  const target = await targetOf(tx, userId);
  if (target === null) {
    return err({ kind: 'AccountNotFound' });
  }
  await tx.user.update({ where: { id: target.id }, data: { sessionsValidFrom: now } });
  await unsubscribeAccount(tx, target.id);
  await recordAudit(tx, actor.tenantId, { action: 'SignedOutEverywhere', actorId: actor.userId, subjectId: target.id, deviceId: actor.deviceId }, now);
  return ok(undefined);
}
