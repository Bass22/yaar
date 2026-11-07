import { err, ok, type Result } from '@kit';
import type { Prisma } from '@prisma/client';
import type { Session } from '../auth/session';

export type AccountAccessRefusal =
  | { readonly kind: 'AccountNotFound' }
  | { readonly kind: 'CannotBlockOwnAccount' }
  | { readonly kind: 'OnlyCollaboratorsCanBeBlocked' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Read in the tenant transaction of the request: an account of another tenant does not exist.
async function targetOf(tx: Prisma.TransactionClient, userId: string) {
  return UUID.test(userId) ? tx.user.findUnique({ where: { id: userId }, select: { id: true, role: true, blockedAt: true } }) : null;
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
  return ok(undefined);
}

/** Lifts a block. The tokens issued before stay refused: the account signs in again. */
export async function unblockAccount(tx: Prisma.TransactionClient, userId: string): Promise<Result<void, AccountAccessRefusal>> {
  const target = await targetOf(tx, userId);
  if (target === null) {
    return err({ kind: 'AccountNotFound' });
  }
  await tx.user.update({ where: { id: target.id }, data: { blockedAt: null } });
  return ok(undefined);
}

/** Every token issued so far stops working; the account is not blocked and signs in again. */
export async function signOutEverywhere(tx: Prisma.TransactionClient, userId: string, now: Date): Promise<Result<void, AccountAccessRefusal>> {
  const target = await targetOf(tx, userId);
  if (target === null) {
    return err({ kind: 'AccountNotFound' });
  }
  await tx.user.update({ where: { id: target.id }, data: { sessionsValidFrom: now } });
  return ok(undefined);
}
