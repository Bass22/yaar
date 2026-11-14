import { err, ok, unwrap, type Result } from '@kit';
import { averageWeight, campaignDay, effectiveJournal, recentBusinessDays, TimeZone, weightCurve, type BusinessDay, type TenantId, isCanonicalUuid, answeredWeighingRequests } from '@domain/journal';
import { Prisma } from '@prisma/client';
import type { RecordWeighingRequest, WeighingsView } from '@contracts';
import { recordAudit } from '../audit/audit';
import type { Session } from '../auth/session';
import { PrismaJournal } from '../journal/prisma-journal';
import { namesOf } from '../journal/author-names';

type Tx = Prisma.TransactionClient;
export type WeighingRequestRefusal = { readonly kind: 'InvalidId' | 'InvalidBusinessDay' | 'RequestedInPast' | 'UnknownCampaign' | 'CampaignClosed' | 'WeighingRequestAlreadyExists' };

/** The chef asks for a weighing (T.2): a running flock of the farm, a day from today on the site. Traced. */
export async function requestWeighing(tx: Tx, admin: Session, request: RecordWeighingRequest, now: Date): Promise<Result<'Recorded' | 'Duplicate', WeighingRequestRefusal>> {
  if (!isCanonicalUuid(request.id)) return err({ kind: 'InvalidId' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(request.requestedFor) || Number.isNaN(Date.parse(request.requestedFor))) return err({ kind: 'InvalidBusinessDay' });
  const campaign = isCanonicalUuid(request.campaignId) ? await tx.campaign.findUnique({ where: { id: request.campaignId }, select: { closedAt: true, site: { select: { id: true, timeZone: true } } } }) : null;
  if (campaign === null) return err({ kind: 'UnknownCampaign' });
  if (campaign.closedAt !== null) return err({ kind: 'CampaignClosed' });
  if (request.requestedFor < recentBusinessDays(now, unwrap(TimeZone(campaign.site.timeZone))).today) return err({ kind: 'RequestedInPast' });
  const existing = await tx.weighingRequest.findUnique({ where: { id: request.id } });
  if (existing !== null) {
    return existing.campaignId === request.campaignId && existing.requestedFor.toISOString().slice(0, 10) === request.requestedFor ? ok('Duplicate') : err({ kind: 'WeighingRequestAlreadyExists' });
  }
  try {
    await tx.weighingRequest.create({ data: { tenantId: admin.tenantId, id: request.id, campaignId: request.campaignId, requestedFor: new Date(request.requestedFor), requestedBy: admin.userId } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return err({ kind: 'WeighingRequestAlreadyExists' });
    throw error;
  }
  await recordAudit(tx, admin.tenantId, { action: 'WeighingRequested', actorId: admin.userId, subjectId: request.id, siteId: campaign.site.id, deviceId: admin.deviceId }, now);
  return ok('Recorded');
}

/**
 * The weighings of a campaign at the office (T.5): the real curve — validated weighings only —
 * and the weighings declared, not taken back, waiting for validation, with their weights as they
 * count and their average, computed here. `null` when the campaign is not the farm's.
 */
export async function campaignWeighings(tx: Tx, tenantId: TenantId, campaignId: string): Promise<WeighingsView | null> {
  const campaign = isCanonicalUuid(campaignId) ? await tx.campaign.findUnique({ where: { id: campaignId }, select: { placementDay: true, siteId: true, strain: true } }) : null;
  if (campaign === null) return null;
  const placementDay = campaign.placementDay.toISOString().slice(0, 10) as BusinessDay;
  const events = await new PrismaJournal(tx, tenantId).campaignJournal(campaignId);
  const lines = effectiveJournal(events);
  const validated = new Set(lines.flatMap(({ fact }) => (fact?.type === 'WeighingValidated' ? [fact.weighingId as string] : [])));
  const waiting = lines.flatMap((line) => (line.fact?.type === 'Weighing' && !validated.has(line.declaration.id) ? [{ declaration: line.declaration, weights: line.fact.weights, photos: line.fact.photos, weighingRequestId: line.fact.weighingRequestId as string }] : []));
  const nameOf = await namesOf(tx, waiting.map(({ declaration }) => declaration.authorId as string));
  const answered = answeredWeighingRequests(events);
  const requests = await tx.weighingRequest.findMany({ where: { campaignId }, orderBy: [{ requestedFor: 'asc' }, { id: 'asc' }] });
  return {
    campaignId,
    siteId: campaign.siteId,
    strain: campaign.strain,
    openRequests: requests.filter(({ id }) => !answered.has(id)).map(({ id, requestedFor }) => ({ weighingRequestId: id, requestedFor: requestedFor.toISOString().slice(0, 10) })),
    curve: weightCurve(events, placementDay),
    toValidate: waiting
      .sort((a, b) => (a.declaration.recordedAt < b.declaration.recordedAt ? -1 : 1))
      .map(({ declaration, weights, photos, weighingRequestId }) => ({
        weighingId: declaration.id,
        weighingRequestId,
        businessDate: declaration.businessDate,
        campaignDay: campaignDay(placementDay, declaration.businessDate),
        authorName: nameOf.get(declaration.authorId) ?? '',
        weights: [...weights],
        photos: photos === undefined ? null : [...photos],
        average: averageWeight(weights),
      })),
  };
}
