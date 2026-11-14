import { err, ok, type Result } from '@kit';
import { COST_CATEGORIES, type CostCategory } from '@domain/finance';
import { Prisma } from '@prisma/client';
import type { ConfigureCostTypeRequest, CostTypeRefusal, CostTypeView, CreateCostTypeRequest } from '@contracts';
import { recordAudit } from '../audit/audit';
import type { Session } from '../auth/session';
import { isCanonicalUuid } from '@domain/journal';
import { nameOf } from '../http/name';

const categoryOf = (category: CostCategory) => COST_CATEGORIES.find((entry) => entry.category === category);
const rankOf = (category: CostCategory) => COST_CATEGORIES.findIndex((entry) => entry.category === category);

/**
 * The farm's cost types, in the order of the base, then in the order they were created — the
 * starting feeds by the age of the flock: démarrage, croissance, finition (N.7); archived ones
 * included and marked.
 */
export async function listCostTypes(tx: Prisma.TransactionClient): Promise<CostTypeView[]> {
  const rows = await tx.costType.findMany({ orderBy: [{ createdAt: 'asc' }, { name: 'asc' }, { id: 'asc' }], select: { id: true, category: true, name: true, behaviour: true, bagWeight: true, archivedAt: true } });
  return rows
    .map(({ archivedAt, ...row }) => ({ ...row, orderable: categoryOf(row.category)?.orderable ?? false, archived: archivedAt !== null }))
    .sort((left, right) => rankOf(left.category) - rankOf(right.category));
}

/** The admin adds a cost type under a category of the base (N.2); it takes the category's flags unless told otherwise. Traced. */
export async function createCostType(tx: Prisma.TransactionClient, admin: Session, request: CreateCostTypeRequest, now: Date): Promise<Result<void, CostTypeRefusal>> {
  const category = categoryOf(request.category);
  if (!isCanonicalUuid(request.id) || category === undefined) {
    return err({ kind: 'InvalidRequest' });
  }
  const name = nameOf(request.name);
  if (!name.ok) {
    return name;
  }
  try {
    await tx.costType.create({ data: { id: request.id, tenantId: admin.tenantId, category: category.category, name: name.value, behaviour: request.behaviour ?? category.behaviour } });
  } catch (error) {
    // The identifier is taken — here, or in another farm, which this transaction does not see.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return err({ kind: 'CostTypeAlreadyExists' });
    }
    throw error;
  }
  await recordAudit(tx, admin.tenantId, { action: 'CostTypeCreated', actorId: admin.userId, subjectId: request.id, deviceId: admin.deviceId }, now);
  return ok(undefined);
}

/** Renaming changes only the label — entries carry the id; the fixed/variable flag may change; the category never. */
export async function configureCostType(tx: Prisma.TransactionClient, admin: Session, id: string, change: ConfigureCostTypeRequest, now: Date): Promise<Result<void, CostTypeRefusal>> {
  const current = isCanonicalUuid(id) ? await tx.costType.findUnique({ where: { id }, select: { name: true, behaviour: true } }) : null;
  if (current === null) {
    return err({ kind: 'CostTypeNotFound' });
  }
  const data: { name?: string; behaviour?: 'Fixed' | 'Variable' } = {};
  if (change.name !== undefined) {
    const name = nameOf(change.name);
    if (!name.ok) {
      return name;
    }
    if (name.value !== current.name) {
      data.name = name.value;
    }
  }
  if (change.behaviour !== undefined && change.behaviour !== current.behaviour) {
    data.behaviour = change.behaviour;
  }
  const changed = Object.keys(data);
  if (changed.length === 0) {
    return ok(undefined);
  }
  await tx.costType.update({ where: { id }, data });
  await recordAudit(tx, admin.tenantId, { action: 'CostTypeConfigured', actorId: admin.userId, subjectId: id, deviceId: admin.deviceId, reason: changed.sort().join(',') }, now);
  return ok(undefined);
}

/** Archived, never deleted: no longer offered, still readable. Archiving twice leaves one trace. */
export async function archiveCostType(tx: Prisma.TransactionClient, admin: Session, id: string, now: Date): Promise<Result<void, CostTypeRefusal>> {
  const current = isCanonicalUuid(id) ? await tx.costType.findUnique({ where: { id }, select: { archivedAt: true } }) : null;
  if (current === null) {
    return err({ kind: 'CostTypeNotFound' });
  }
  if (current.archivedAt !== null) {
    return ok(undefined);
  }
  await tx.costType.update({ where: { id }, data: { archivedAt: now } });
  await recordAudit(tx, admin.tenantId, { action: 'CostTypeArchived', actorId: admin.userId, subjectId: id, deviceId: admin.deviceId }, now);
  return ok(undefined);
}
