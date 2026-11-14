import { err, ok, type Result } from '@kit';
import { Prisma } from '@prisma/client';
import type { AttachRefusal, AttachRequest } from '@contracts';
import { recordAudit } from '../audit/audit';
import type { Session } from '../auth/session';

type Tx = Prisma.TransactionClient;

/**
 * A photo joined to an order or a payment (R.6; decision of 2026-11-13), at the time or later. The
 * entry never changes: the joining is written apart, added once. The photo was sent first to the
 * media store; the same photo joined twice to the same counts once. Traced.
 */
export async function attach(tx: Tx, admin: Session, request: AttachRequest, now: Date): Promise<Result<'Attached' | 'AlreadyThere', AttachRefusal>> {
  const media = await tx.media.findUnique({ where: { tenantId_sha256: { tenantId: admin.tenantId, sha256: request.media } }, select: { sha256: true } });
  if (media === null) return err({ kind: 'UnknownMedia' });
  const subject =
    request.subjectKind === 'Order'
      ? await tx.purchaseOrder.findUnique({ where: { id: request.subjectId }, select: { id: true } })
      : await tx.payment.findUnique({ where: { id: request.subjectId }, select: { id: true } });
  if (subject === null) return err({ kind: 'UnknownSubject' });
  const already = await tx.attachment.findFirst({ where: { OR: [{ id: request.id }, { subjectKind: request.subjectKind, subjectId: request.subjectId, mediaSha256: request.media }] }, select: { id: true } });
  if (already !== null) return ok('AlreadyThere');
  await tx.attachment.create({ data: { tenantId: admin.tenantId, id: request.id, subjectKind: request.subjectKind, subjectId: request.subjectId, mediaSha256: request.media, attachedAt: now, attachedBy: admin.userId } });
  await recordAudit(tx, admin.tenantId, { action: 'AttachmentAdded', actorId: admin.userId, subjectId: request.subjectId, deviceId: admin.deviceId }, now);
  return ok('Attached');
}
