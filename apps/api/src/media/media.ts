import { Prisma } from '@prisma/client';
import type { Session } from '../auth/session';
import type { MediaContentType } from './media-store';

type Tx = Prisma.TransactionClient;

/** Says how long a media is kept (architecture §7): a delivery note or a receipt is a supporting document. */
export const RETENTION_CLASSES = Object.freeze(['OperationalProof', 'SupportingDocument'] as const);
export type RetentionClass = (typeof RETENTION_CLASSES)[number];

export type StoredMedia = { readonly sha256: string; readonly byteSize: number; readonly contentType: MediaContentType };

/**
 * Keeps the row of a media just written to the volume (M.1): the farm, the fingerprint, what it
 * is, its retention class, who sent it, when, from which device. The row is the trace. Already
 * there: nothing changes, and the caller answers « already there ».
 */
export async function storeMedia(tx: Tx, session: Session, media: StoredMedia, retentionClass: RetentionClass, now: Date): Promise<'Stored' | 'AlreadyThere'> {
  const existing = await tx.media.findUnique({ where: { tenantId_sha256: { tenantId: session.tenantId, sha256: media.sha256 } }, select: { sha256: true } });
  if (existing !== null) return 'AlreadyThere';
  try {
    await tx.media.create({
      data: { tenantId: session.tenantId, sha256: media.sha256, byteSize: media.byteSize, contentType: media.contentType, retentionClass, uploadedBy: session.userId, deviceId: session.deviceId, uploadedAt: now },
    });
  } catch (error) {
    // Sent twice at once: the other request kept it.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return 'AlreadyThere';
    throw error;
  }
  return 'Stored';
}

/**
 * The media of the farm that an event of its journal references — a photo, or the paper of a
 * delivery; `null` otherwise: a file sent but never cited is not read (M.1). Admin only, checked
 * by the route.
 */
export async function readMedia(tx: Tx, tenantId: string, sha256: string): Promise<{ readonly contentType: string } | null> {
  const media = await tx.media.findUnique({ where: { tenantId_sha256: { tenantId, sha256 } }, select: { contentType: true } });
  if (media === null) return null;
  const cited = await tx.journalEvent.findFirst({
    where: { OR: [{ fact: { path: ['media'], equals: sha256 } }, { fact: { path: ['deliveryNote', 'media'], equals: sha256 } }] },
    select: { id: true },
  });
  return cited === null ? null : media;
}

