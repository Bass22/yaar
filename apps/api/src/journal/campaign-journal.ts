import { unwrap } from '@kit';
import { addDays, CampaignId, campaignDay, effectiveJournal, factOf, recentBusinessDays, summarizeDay, TimeZone, type BusinessDay, type TenantId, isCanonicalUuid } from '@domain/journal';
import type { Prisma } from '@prisma/client';
import type { CampaignDayView, CampaignJournalView, FactPayload, OfficeJournalLine } from '@contracts';
import { PrismaJournal } from './prisma-journal';
import { namesOf } from './author-names';

type Tx = Prisma.TransactionClient;

/**
 * The journal of a campaign at the office (O.7): every declaration, as written, with what counts
 * today and who corrected or took it back — nothing erased (rule 1). Latest day first, then latest
 * written. `null` when the campaign is not the farm's.
 */
export async function campaignJournal(tx: Tx, tenantId: TenantId, campaignId: string, now: Date): Promise<CampaignJournalView | null> {
  const campaign = isCanonicalUuid(campaignId)
    ? await tx.campaign.findUnique({ where: { id: campaignId }, select: { siteId: true, placementDay: true, closedAt: true, site: { select: { timeZone: true } } } })
    : null;
  if (campaign === null) return null;
  const events = await new PrismaJournal(tx, tenantId).campaignJournal(campaignId);
  const lines = effectiveJournal(events);
  const authorIds = new Set(lines.flatMap(({ declaration, correction, retraction }) => [declaration.authorId, correction?.authorId, retraction?.authorId].filter((id): id is NonNullable<typeof id> => id !== undefined)));
  const nameOf = await namesOf(tx, authorIds);
  const by = (written: { authorId: string; recordedAt: string }) => ({ author: { id: written.authorId, name: nameOf.get(written.authorId) ?? '' }, recordedAt: written.recordedAt });
  const deliveredIds = [...new Set(lines.flatMap(({ declaration }) => (declaration.type === 'Delivery' ? [declaration.orderLineId] : [])))];
  const delivered = await tx.orderLine.findMany({ where: { id: { in: deliveredIds } }, select: { id: true, costType: { select: { name: true } } } });
  const nameOfLine = new Map(delivered.map(({ id, costType }) => [id, costType.name]));

  const view: OfficeJournalLine[] = lines.map(({ declaration, correction, retraction, fact }) => {
    const deliveryName = declaration.type === 'Delivery' ? nameOfLine.get(declaration.orderLineId) : undefined;
    return {
      id: declaration.id,
      siteId: declaration.siteId,
      businessDate: declaration.businessDate,
      ...by(declaration),
      declared: factOf(declaration) as FactPayload,
      fact: fact === null ? null : (fact as FactPayload),
      correction: correction === null ? null : by(correction),
      retraction: retraction === null ? null : by(retraction),
      ...(deliveryName === undefined ? {} : { delivery: { name: deliveryName } }),
    };
  });
  view.sort((a, b) => (a.businessDate !== b.businessDate ? (a.businessDate < b.businessDate ? 1 : -1) : a.recordedAt < b.recordedAt ? 1 : a.recordedAt > b.recordedAt ? -1 : 0));
  const placementDay = campaign.placementDay.toISOString().slice(0, 10) as BusinessDay;
  const timeZone = unwrap(TimeZone(campaign.site.timeZone));
  const today = recentBusinessDays(now, timeZone).today;
  // The calendar (O.8): every day from J0 to today — or to the closing —, summed up by the domain's rule.
  const lastDay = campaign.closedAt === null ? today : (recentBusinessDays(campaign.closedAt, timeZone).today as BusinessDay);
  const id = unwrap(CampaignId(campaignId));
  const days: CampaignDayView[] = [];
  for (let day = placementDay; day <= lastDay; day = addDays(day, 1)) {
    const summary = summarizeDay(events, { campaignId: id, businessDate: day });
    days.push({ day, campaignDay: campaignDay(placementDay, day), mortality: summary.mortality, bagsOpened: summary.bagsOpened.reduce((sum, { quantity }) => sum + quantity, 0) });
  }
  return {
    campaignId,
    siteId: campaign.siteId,
    placementDay,
    today,
    days,
    closed: campaign.closedAt !== null,
    lines: view,
  };
}
