import type { Prisma } from '@prisma/client';
import type { Session } from './session';
import { isCanonicalUuid } from '@domain/journal';

/**
 * Whether the caller may reach a site: the admin reaches every site of the tenant, a
 * collaborator only those they are assigned to (primary caretaker or substitute). Runs in the
 * tenant transaction: a site of another tenant does not exist here. Strict mode is a rule of
 * declaration (C.3), not of access.
 */
export async function canReachSite(tx: Prisma.TransactionClient, session: Session, siteId: string): Promise<boolean> {
  if (!isCanonicalUuid(siteId)) {
    return false;
  }
  return (await tx.site.count({ where: { id: siteId, ...reachableSites(session) } })) === 1;
}

/** The sites the session reaches, as a query: every site of the farm for the admin, a collaborator's own for a caretaker. */
export function reachableSites(session: Session): Prisma.SiteWhereInput {
  return session.role === 'admin' ? {} : { assignments: { some: { userId: session.userId } } };
}
