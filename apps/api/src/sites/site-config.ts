import { err, ok, type Result } from '@kit';
import { TimeZone, isCanonicalUuid } from '@domain/journal';
import { Prisma } from '@prisma/client';
import type { AudioLanguage, ConfigureSiteRequest, CreateSiteRequest, SiteConfigRefusal } from '@contracts';
import { recordAudit } from '../audit/audit';
import type { Session } from '../auth/session';
import { nameOf } from '../http/name';

/**
 * The admin creates a site of the farm of the session (O.1). Its strict mode starts off — the
 * admin's choice, later (CdC « Mode strict optionnel ») —, its voice follows each person unless
 * one is given. The creation is traced (rule 14).
 */
export async function createSite(tx: Prisma.TransactionClient, admin: Session, request: CreateSiteRequest, now: Date): Promise<Result<void, SiteConfigRefusal>> {
  if (!isCanonicalUuid(request.id)) {
    return err({ kind: 'InvalidRequest' });
  }
  const name = nameOf(request.name);
  if (!name.ok) {
    return name;
  }
  if (!TimeZone(request.timeZone).ok) {
    return err({ kind: 'InvalidTimeZone' });
  }
  try {
    await tx.site.create({ data: { id: request.id, tenantId: admin.tenantId, name: name.value, timeZone: request.timeZone, audioLanguage: request.audioLanguage ?? null } });
  } catch (error) {
    // The identifier is taken — here, or in another farm, which this transaction does not see.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return err({ kind: 'SiteAlreadyExists' });
    }
    throw error;
  }
  await recordAudit(tx, admin.tenantId, { action: 'SiteCreated', actorId: admin.userId, subjectId: request.id, siteId: request.id, deviceId: admin.deviceId }, now);
  return ok(undefined);
}

/**
 * The admin changes a site's name, default voice or strict mode. What changed is traced, by
 * field name; a change that changes nothing leaves no trace. A site of another farm does not exist.
 */
export async function configureSite(tx: Prisma.TransactionClient, admin: Session, siteId: string, change: ConfigureSiteRequest, now: Date): Promise<Result<void, SiteConfigRefusal>> {
  const site = isCanonicalUuid(siteId) ? await tx.site.findUnique({ where: { id: siteId }, select: { name: true, audioLanguage: true, strictMode: true } }) : null;
  if (site === null) {
    return err({ kind: 'SiteNotFound' });
  }
  const data: { name?: string; audioLanguage?: AudioLanguage | null; strictMode?: boolean } = {};
  if (change.name !== undefined) {
    const name = nameOf(change.name);
    if (!name.ok) {
      return name;
    }
    if (name.value !== site.name) {
      data.name = name.value;
    }
  }
  if (change.audioLanguage !== undefined && change.audioLanguage !== site.audioLanguage) {
    data.audioLanguage = change.audioLanguage;
  }
  if (change.strictMode !== undefined && change.strictMode !== site.strictMode) {
    data.strictMode = change.strictMode;
  }
  const changed = Object.keys(data);
  if (changed.length === 0) {
    return ok(undefined);
  }
  await tx.site.update({ where: { id: siteId }, data });
  await recordAudit(tx, admin.tenantId, { action: 'SiteConfigured', actorId: admin.userId, subjectId: siteId, siteId, deviceId: admin.deviceId, reason: changed.sort().join(',') }, now);
  return ok(undefined);
}
