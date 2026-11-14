import { err, ok, type Result } from '@kit';
import type { Prisma } from '@prisma/client';
import type { CorrectionToReview } from '@contracts';
import { recordAudit } from '../audit/audit';
import type { Session } from '../auth/session';
import { averageWeight, campaignDay, inWritingOrder, isCanonicalUuid, type BusinessDay, type Weight } from '@domain/journal';

type Tx = Prisma.TransactionClient;

const dayOf = (date: Date): BusinessDay => date.toISOString().slice(0, 10) as BusinessDay;
const plural = (count: number, one: string, many: string): string => `${count} ${count > 1 ? many : one}`;

/** What a fact counts, in words: « 3 morts », « 2 sacs ouverts », « 8 reçus ». Never an amount: the journal has none. */
export function factWords(type: string | null, fact: unknown): string {
  const values = (typeof fact === 'object' && fact !== null ? fact : {}) as Record<string, unknown>;
  const count = (key: string) => (typeof values[key] === 'number' ? (values[key] as number) : 0);
  switch (type) {
    case 'Death':
      return plural(count('quantity'), 'mort', 'morts');
    case 'BagOpened':
      return plural(count('quantity'), 'sac ouvert', 'sacs ouverts');
    case 'Delivery':
      return plural(count('receivedQuantity'), 'reçu', 'reçus');
    case 'NoLoss':
      return 'rien perdu';
    case 'Weighing': {
      const weights = Array.isArray(values['weights']) ? (values['weights'] as unknown[]).filter((weight): weight is number => typeof weight === 'number') : [];
      return weights.length === 0 ? 'une pesée' : `pesée, moyenne ${averageWeight(weights as Weight[])} g`;
    }
    default:
      return 'une déclaration';
  }
}

/**
 * The corrections caretakers wrote that no admin has seen yet (Y.2b), latest first: what counted
 * before each one — the declaration, or the correction before it — and what counts after. `ids`
 * narrows to the corrections just written (to tell the admins of them).
 */
export async function correctionsToReview(tx: Tx, ids?: readonly string[]): Promise<CorrectionToReview[]> {
  const rows = await tx.journalEvent.findMany({
    where: { corrects: { not: null }, type: { not: null }, author: { role: 'collaborator' }, review: { is: null }, ...(ids === undefined ? {} : { id: { in: [...ids] } }) },
    select: { id: true, corrects: true, type: true, fact: true, businessDate: true, recordedAt: true, campaignId: true, siteId: true, author: { select: { name: true } }, site: { select: { name: true } }, campaign: { select: { placementDay: true } } },
    orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
  });
  const roots = [...new Set(rows.map(({ corrects }) => corrects as string))];
  const chain = await tx.journalEvent.findMany({ where: { type: { not: null }, OR: [{ id: { in: roots } }, { corrects: { in: roots } }] }, select: { id: true, corrects: true, type: true, fact: true, recordedAt: true } });
  // The latest writing counts (rule 1): the domain's order of writing, on the instants read here.
  const earlier = (a: { recordedAt: Date; id: string }, b: { recordedAt: Date; id: string }) => inWritingOrder({ recordedAt: a.recordedAt.toISOString(), id: a.id }, { recordedAt: b.recordedAt.toISOString(), id: b.id });
  return rows.map((row) => {
    const root = row.corrects as string;
    // What counted just before this correction: the latest writing of the same declaration before it.
    const previous = chain.filter((event) => (event.id === root || event.corrects === root) && earlier(event, row) < 0).sort(earlier).at(-1);
    return {
      correctionId: row.id,
      campaignId: row.campaignId,
      siteId: row.siteId,
      siteName: row.site.name,
      businessDate: row.businessDate.toISOString().slice(0, 10),
      campaignDay: campaignDay(dayOf(row.campaign.placementDay), dayOf(row.businessDate)),
      authorName: row.author.name,
      before: factWords(previous?.type ?? null, previous?.fact),
      after: factWords(row.type, row.fact),
      recordedAt: row.recordedAt.toISOString(),
    };
  });
}

export type ReviewRefusal = { readonly kind: 'CorrectionNotFound' };

/** « Vu » (Y.2b): the card goes, once for all, traced; seen twice keeps the first. The journal is not touched. */
export async function reviewCorrection(tx: Tx, admin: Session, id: string, now: Date): Promise<Result<void, ReviewRefusal>> {
  const correction = isCanonicalUuid(id) ? await tx.journalEvent.findFirst({ where: { id, corrects: { not: null }, author: { role: 'collaborator' } }, select: { siteId: true, review: { select: { correctionId: true } } } }) : null;
  if (correction === null) return err({ kind: 'CorrectionNotFound' });
  if (correction.review !== null) return ok(undefined);
  await tx.correctionReview.create({ data: { tenantId: admin.tenantId, correctionId: id, reviewedBy: admin.userId, reviewedAt: now } });
  await recordAudit(tx, admin.tenantId, { action: 'CorrectionReviewed', actorId: admin.userId, subjectId: id, siteId: correction.siteId, deviceId: admin.deviceId }, now);
  return ok(undefined);
}
