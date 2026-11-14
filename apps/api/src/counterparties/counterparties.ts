import { err, ok, type Result } from '@kit';
import { Prisma } from '@prisma/client';
import type { ConfigureCounterpartyRequest, CounterpartyRefusal, CounterpartyView, CreateCounterpartyRequest } from '@contracts';
import { recordAudit } from '../audit/audit';
import type { Session } from '../auth/session';
import { isCanonicalUuid } from '@domain/journal';
import { nameOf } from '../http/name';

/** The farm's counterparties, by name; archived ones included and marked — they stay readable. */
export async function listCounterparties(tx: Prisma.TransactionClient): Promise<CounterpartyView[]> {
  const rows = await tx.counterparty.findMany({ orderBy: [{ name: 'asc' }, { id: 'asc' }], select: { id: true, kind: true, name: true, face: true, advancesExpenses: true, archivedAt: true } });
  return rows.map(({ archivedAt, face, ...row }) => ({ ...row, face: face as CounterpartyView['face'], archived: archivedAt !== null }));
}

/** The admin creates a counterparty of the farm of the session (N.3); the creation is traced. */
export async function createCounterparty(tx: Prisma.TransactionClient, admin: Session, request: CreateCounterpartyRequest, now: Date): Promise<Result<void, CounterpartyRefusal>> {
  if (!isCanonicalUuid(request.id)) {
    return err({ kind: 'InvalidRequest' });
  }
  const name = nameOf(request.name);
  if (!name.ok) {
    return name;
  }
  try {
    await tx.counterparty.create({ data: { id: request.id, tenantId: admin.tenantId, kind: request.kind, name: name.value, face: request.face, advancesExpenses: request.advancesExpenses ?? false } });
  } catch (error) {
    // The identifier is taken — here, or in another farm, which this transaction does not see.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return err({ kind: 'CounterpartyAlreadyExists' });
    }
    throw error;
  }
  await recordAudit(tx, admin.tenantId, { action: 'CounterpartyCreated', actorId: admin.userId, subjectId: request.id, deviceId: admin.deviceId }, now);
  return ok(undefined);
}

/** The admin changes a counterparty's name or face, never its kind; what changed is traced. */
export async function configureCounterparty(tx: Prisma.TransactionClient, admin: Session, id: string, change: ConfigureCounterpartyRequest, now: Date): Promise<Result<void, CounterpartyRefusal>> {
  const current = isCanonicalUuid(id) ? await tx.counterparty.findUnique({ where: { id }, select: { name: true, face: true, advancesExpenses: true } }) : null;
  if (current === null) {
    return err({ kind: 'CounterpartyNotFound' });
  }
  const data: { name?: string; face?: string; advancesExpenses?: boolean } = {};
  if (change.name !== undefined) {
    const name = nameOf(change.name);
    if (!name.ok) {
      return name;
    }
    if (name.value !== current.name) {
      data.name = name.value;
    }
  }
  if (change.face !== undefined && change.face !== current.face) {
    data.face = change.face;
  }
  if (change.advancesExpenses !== undefined && change.advancesExpenses !== current.advancesExpenses) {
    data.advancesExpenses = change.advancesExpenses;
  }
  const changed = Object.keys(data);
  if (changed.length === 0) {
    return ok(undefined);
  }
  await tx.counterparty.update({ where: { id }, data });
  await recordAudit(tx, admin.tenantId, { action: 'CounterpartyConfigured', actorId: admin.userId, subjectId: id, deviceId: admin.deviceId, reason: changed.sort().join(',') }, now);
  return ok(undefined);
}

/** Archived, never deleted: no longer offered, still readable. Archiving twice leaves one trace. */
export async function archiveCounterparty(tx: Prisma.TransactionClient, admin: Session, id: string, now: Date): Promise<Result<void, CounterpartyRefusal>> {
  const current = isCanonicalUuid(id) ? await tx.counterparty.findUnique({ where: { id }, select: { archivedAt: true } }) : null;
  if (current === null) {
    return err({ kind: 'CounterpartyNotFound' });
  }
  if (current.archivedAt !== null) {
    return ok(undefined);
  }
  await tx.counterparty.update({ where: { id }, data: { archivedAt: now } });
  await recordAudit(tx, admin.tenantId, { action: 'CounterpartyArchived', actorId: admin.userId, subjectId: id, deviceId: admin.deviceId }, now);
  return ok(undefined);
}
