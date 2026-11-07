import { randomUUID } from 'node:crypto';
import type { AuditAction, Prisma } from '@prisma/client';

export type AuditEntry = {
  readonly action: AuditAction;
  /** Who acted: the admin, or the account itself when it signs in; null for the operator, by script. */
  readonly actorId: string | null;
  /** The account the action was about. */
  readonly subjectId: string;
  /** The site the action was about, when it was about one. */
  readonly siteId?: string;
  readonly deviceId: string | null;
  /** Why a sign-in failed or was refused: the kind of the refusal, never what was typed. */
  readonly reason?: string;
};

/**
 * Adds one line to the audit trail, in the tenant transaction the caller is in: the action and
 * its trace commit or roll back together (CLAUDE.md §4 rule 14). The trail is append-only and
 * holds no secret — identifiers, the instant, and a reason from a closed list.
 */
export async function recordAudit(tx: Prisma.TransactionClient, tenantId: string, entry: AuditEntry, at: Date): Promise<void> {
  await tx.auditEvent.create({
    data: { tenantId, id: randomUUID(), occurredAt: at, action: entry.action, actorId: entry.actorId, subjectId: entry.subjectId, siteId: entry.siteId ?? null, deviceId: entry.deviceId, reason: entry.reason ?? null },
  });
}
