import type { Prisma } from '@prisma/client';
import type { Session } from './session';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Whether the caller may reach a site: the admin reaches every site of the tenant, a
 * collaborator only those they are assigned to (primary caretaker or substitute). Runs in the
 * tenant transaction: a site of another tenant does not exist here. Strict mode is a rule of
 * declaration (C.3), not of access.
 */
export async function canReachSite(tx: Prisma.TransactionClient, session: Session, siteId: string): Promise<boolean> {
  if (!UUID.test(siteId)) {
    return false;
  }
  if (session.role === 'admin') {
    return (await tx.site.count({ where: { id: siteId } })) === 1;
  }
  return (await tx.siteAssignment.count({ where: { siteId, userId: session.userId } })) === 1;
}
