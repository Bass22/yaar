import { err, ok, type Result } from '@kit';
import type { Prisma } from '@prisma/client';
import type { SiteStaffRefusal } from '@contracts';
import { recordAudit } from '../audit/audit';
import type { Session } from '../auth/session';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Locks the site for the rest of the transaction: two admins changing the staff of one site at
 * the same moment are served one after the other, so a site never ends with two primaries nor
 * fails on the unique index. Read in the tenant transaction: a site of another tenant does not
 * exist here.
 */
async function lockSite(tx: Prisma.TransactionClient, siteId: string): Promise<boolean> {
  if (!UUID.test(siteId)) {
    return false;
  }
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM sites WHERE id = ${siteId}::uuid FOR UPDATE`;
  return rows.length === 1;
}

// Only collaborators are assigned: an admin already reaches every site of the tenant.
async function collaboratorOf(tx: Prisma.TransactionClient, userId: string): Promise<Result<string, SiteStaffRefusal>> {
  const user = UUID.test(userId) ? await tx.user.findUnique({ where: { id: userId }, select: { id: true, role: true } }) : null;
  if (user === null) {
    return err({ kind: 'AccountNotFound' });
  }
  return user.role === 'collaborator' ? ok(user.id) : err({ kind: 'OnlyCollaboratorsAreAssigned' });
}

async function staffTarget(tx: Prisma.TransactionClient, siteId: string, userId: string): Promise<Result<string, SiteStaffRefusal>> {
  if (!(await lockSite(tx, siteId))) {
    return err({ kind: 'SiteNotFound' });
  }
  return collaboratorOf(tx, userId);
}

/**
 * The admin lets a collaborator write in the notebook of a site, as a substitute — or as its
 * primary caretaker when the site has none (decision of 2026-11-07: one site, one caretaker, one
 * gesture). Assigning someone already there changes nothing — a primary stays primary — and
 * leaves no trace.
 */
export async function assignToSite(tx: Prisma.TransactionClient, admin: Session, siteId: string, userId: string, now: Date): Promise<Result<void, SiteStaffRefusal>> {
  const target = await staffTarget(tx, siteId, userId);
  if (!target.ok) {
    return target;
  }
  const existing = await tx.siteAssignment.findUnique({ where: { siteId_userId: { siteId, userId: target.value } } });
  if (existing !== null) {
    return ok(undefined);
  }
  const isPrimary = (await tx.siteAssignment.count({ where: { siteId, isPrimary: true } })) === 0;
  await tx.siteAssignment.create({ data: { tenantId: admin.tenantId, siteId, userId: target.value, isPrimary } });
  const action = isPrimary ? 'PrimaryCaretakerDesignated' : 'SiteAssigned';
  await recordAudit(tx, admin.tenantId, { action, actorId: admin.userId, subjectId: target.value, siteId, deviceId: admin.deviceId }, now);
  return ok(undefined);
}

/**
 * The admin removes someone from a site: they no longer reach it from their next request.
 * Removing the primary leaves the site without one until the admin designates another
 * (decision of 2026-11-07); the substitutes stay.
 */
export async function removeFromSite(tx: Prisma.TransactionClient, admin: Session, siteId: string, userId: string, now: Date): Promise<Result<void, SiteStaffRefusal>> {
  if (!(await lockSite(tx, siteId))) {
    return err({ kind: 'SiteNotFound' });
  }
  const removed = UUID.test(userId) ? await tx.siteAssignment.deleteMany({ where: { siteId, userId } }) : { count: 0 };
  if (removed.count === 0) {
    return err({ kind: 'AssignmentNotFound' });
  }
  await recordAudit(tx, admin.tenantId, { action: 'SiteUnassigned', actorId: admin.userId, subjectId: userId, siteId, deviceId: admin.deviceId }, now);
  return ok(undefined);
}

/**
 * The admin designates the primary caretaker of a site — assigning them there if they were not.
 * A site has one primary: the previous one becomes a substitute and keeps their access
 * (decision of 2026-11-07). Designating the primary in place changes nothing.
 */
export async function designatePrimaryCaretaker(tx: Prisma.TransactionClient, admin: Session, siteId: string, userId: string, now: Date): Promise<Result<void, SiteStaffRefusal>> {
  const target = await staffTarget(tx, siteId, userId);
  if (!target.ok) {
    return target;
  }
  const current = await tx.siteAssignment.findFirst({ where: { siteId, isPrimary: true }, select: { userId: true } });
  if (current?.userId === target.value) {
    return ok(undefined);
  }
  if (current !== null) {
    await tx.siteAssignment.update({ where: { siteId_userId: { siteId, userId: current.userId } }, data: { isPrimary: false } });
  }
  await tx.siteAssignment.upsert({
    where: { siteId_userId: { siteId, userId: target.value } },
    create: { tenantId: admin.tenantId, siteId, userId: target.value, isPrimary: true },
    update: { isPrimary: true },
  });
  await recordAudit(tx, admin.tenantId, { action: 'PrimaryCaretakerDesignated', actorId: admin.userId, subjectId: target.value, siteId, deviceId: admin.deviceId }, now);
  return ok(undefined);
}
