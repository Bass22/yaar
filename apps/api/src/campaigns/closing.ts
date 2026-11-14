import { err, Money, ok, unwrap, type CurrencyCode, type Result } from '@kit';
import { closingReport, NOTE_MAX_LENGTH, transferLeftovers } from '@domain/finance';
import { CampaignId, checkFeedCount, computeLiveCount, feedBagsWaiting, recordLeftovers, type BusinessDay, type JournalEvent, type TenantId, isCanonicalUuid } from '@domain/journal';
import type { Prisma } from '@prisma/client';
import type { CampaignClosingRefusal, ClosedLotView, CloseCampaignRequest, ClosingReportView } from '@contracts';
import { recordAudit } from '../audit/audit';
import type { Session } from '../auth/session';
import { campaignMoney } from '../costs/costs';
import { PrismaJournal } from '../journal/prisma-journal';
import { campaignSales } from '../sales/sales';
import { feedContextOf } from './feed';
import { leftoverValuesOf, writtenLeftovers } from './leftovers';
import { currencyOf } from '../tenants/currency';
import { placementOrderLinesOf } from '../journal/birds';

type Tx = Prisma.TransactionClient;

/**
 * The admin closes a campaign (X.2; CdC « Les restes et le bilan »), online and at once: its
 * leftovers — or none —, the campaign of the same site that receives them, and the comment of its
 * report. Nothing is erased; the closing date stops every new entry. Traced.
 */
export async function closeCampaign(tx: Tx, admin: Session, campaignId: string, request: CloseCampaignRequest, now: Date): Promise<Result<void, CampaignClosingRefusal>> {
  const campaign = isCanonicalUuid(campaignId) ? await tx.campaign.findUnique({ where: { id: campaignId }, select: { siteId: true, closedAt: true, placementDay: true } }) : null;
  if (campaign === null) return err({ kind: 'CampaignNotFound' });
  if (campaign.closedAt !== null) return err({ kind: 'CampaignClosed' });

  const ids = request.leftovers.map(({ costTypeId }) => costTypeId);
  const malformed = ids.find((id) => !isCanonicalUuid(id));
  if (malformed !== undefined) return err({ kind: 'InvalidId', costTypeId: malformed });
  const types = new Map((await tx.costType.findMany({ where: { id: { in: ids } }, select: { id: true, category: true } })).map(({ id, category }) => [id, category]));
  const unknown = ids.find((id) => !types.has(id));
  if (unknown !== undefined) return err({ kind: 'UnknownCostType', costTypeId: unknown });
  const leftovers = recordLeftovers(request.leftovers.map((leftover) => ({ ...leftover, category: types.get(leftover.costTypeId) ?? '' })));
  if (!leftovers.ok) return err(leftovers.error);

  let leftoversTo: string | null = null;
  if (leftovers.value.length > 0) {
    if (request.leftoversTo === null) return err({ kind: 'LeftoversWithoutReceiver' });
    const receiver = isCanonicalUuid(request.leftoversTo) ? await tx.campaign.findUnique({ where: { id: request.leftoversTo }, select: { siteId: true, closedAt: true } }) : null;
    if (receiver === null) return err({ kind: 'UnknownReceiver' });
    // The domain judges the receiver; the value moves by itself, recomputed on both sides (rule 8).
    const currency = await currencyOf(tx, admin.tenantId);
    const transfer = transferLeftovers([], { from: { campaignId, siteId: campaign.siteId }, to: { campaignId: request.leftoversTo, siteId: receiver.siteId, closed: receiver.closedAt !== null } }, currency as CurrencyCode);
    if (!transfer.ok) return err(transfer.error);
    leftoversTo = request.leftoversTo;
  }

  const comment = request.comment?.trim() ?? '';
  if (comment.length > NOTE_MAX_LENGTH) return err({ kind: 'CommentTooLong', max: NOTE_MAX_LENGTH });

  // The bags of feed counted against those expected, all feeds together: a gap is explained (N.8d).
  const counted = closedFeedBags(leftovers.value.map(({ costTypeId, whole }) => ({ category: types.get(costTypeId) ?? '', whole })));
  const expected = await feedBagsExpected(tx, admin.tenantId as TenantId, campaignId, campaign.placementDay);
  const feedCount = checkFeedCount({ counted, expected, comment: request.feedGapComment ?? null });
  if (!feedCount.ok) return err(feedCount.error);
  if ((feedCount.value.comment ?? '').length > NOTE_MAX_LENGTH) return err({ kind: 'CommentTooLong', max: NOTE_MAX_LENGTH });

  // Closed once: a closing that raced this one finds the campaign closed and writes nothing.
  const closed = await tx.campaign.updateMany({ where: { id: campaignId, closedAt: null }, data: { closedAt: now, leftoversTo, closingComment: comment === '' ? null : comment, feedGapComment: feedCount.value.comment } });
  if (closed.count === 0) return err({ kind: 'CampaignClosed' });
  await tx.campaignLeftover.createMany({ data: leftovers.value.map(({ costTypeId, whole, opened, openedWeight }) => ({ tenantId: admin.tenantId, campaignId, costTypeId, whole, opened, openedWeight })) });
  await recordAudit(tx, admin.tenantId, { action: 'CampaignClosed', actorId: admin.userId, subjectId: campaignId, siteId: campaign.siteId, deviceId: admin.deviceId }, now);
  return ok(undefined);
}

/** The bags of feed the campaign should still find closed (N.8d): received and left to it, less those its journal opened. */
/** The closed bags of feed counted at the closing, all feeds together (N.8d): the opened one is not a bag left. */
function closedFeedBags(leftovers: readonly { readonly category: string; readonly whole: number }[]): number {
  return leftovers.reduce((sum, { category, whole }) => sum + (category === 'Feed' ? whole : 0), 0);
}

async function feedBagsExpected(tx: Tx, tenantId: TenantId, campaignId: string, placementDay: Date, events?: readonly JournalEvent[]): Promise<number> {
  const [journal, feed] = await Promise.all([events === undefined ? new PrismaJournal(tx, tenantId).campaignJournal(campaignId) : Promise.resolve(events), feedContextOf(tx, campaignId)]);
  return feedBagsWaiting(journal, { campaignId: unwrap(CampaignId(campaignId)), placementDay: dayOf(placementDay) as BusinessDay, feedLines: feed.feedLines, carriedOver: feed.carriedClosed });
}

/**
 * The report of a closed campaign (X.1, X.2), recomputed from the entries every time: only the
 * leftovers and the comment were written at the closing. `null` while it runs — the report exists
 * only at the closing — or when it is not the farm's.
 */
export async function campaignClosingReport(tx: Tx, tenantId: TenantId, campaignId: string): Promise<ClosingReportView | null> {
  const campaign = isCanonicalUuid(campaignId)
    ? await tx.campaign.findUnique({
        where: { id: campaignId },
        select: { placementDay: true, closedAt: true, closingComment: true, feedGapComment: true, site: { select: { name: true } }, receiver: { select: { id: true, placementDay: true, site: { select: { name: true } } } } },
      })
    : null;
  if (campaign === null || campaign.closedAt === null) return null;
  const [money, sales, events, chickLines, written] = await Promise.all([
    campaignMoney(tx, tenantId, campaignId),
    campaignSales(tx, tenantId, campaignId),
    new PrismaJournal(tx, tenantId).campaignJournal(campaignId),
    placementOrderLinesOf(tx, campaignId),
    writtenLeftovers(tx, campaignId),
  ]);
  if (money === null || sales === null) return null;
  const currency = money.currency as CurrencyCode;
  const values = await leftoverValuesOf(tx, tenantId, campaignId, currency);
  const transferred = values.reduce((sum, { value }) => sum + (value?.amount ?? 0), 0);
  const count = computeLiveCount(events, { campaignId: unwrap(CampaignId(campaignId)), placementOrderLines: chickLines, sold: sales.birdsSold });
  const report = closingReport({
    count,
    committed: unwrap(Money.of(money.committed, currency)),
    transferred: unwrap(Money.of(transferred, currency)),
    sales: { birdsSold: sales.birdsSold, revenue: unwrap(Money.of(sales.revenue, currency)), cashedIn: unwrap(Money.of(sales.cashedIn, currency)) },
    comment: campaign.closingComment,
  });
  if (!report.ok) throw new Error(`The comment of campaign ${campaignId} was written too long`);
  const { value } = report;
  const receiver = campaign.receiver;
  return {
    campaignId,
    siteName: campaign.site.name,
    placementDay: dayOf(campaign.placementDay),
    closedAt: campaign.closedAt.toISOString(),
    currency,
    chicksReceived: value.chicksReceived,
    deaths: value.deaths,
    losses: value.losses,
    birdsSold: value.birdsSold,
    costs: value.costs.amount,
    leftovers: written.map((leftover, index) => ({ costTypeId: leftover.costTypeId, name: leftover.name, unit: leftover.unit, whole: leftover.whole, opened: leftover.opened, openedWeight: leftover.openedWeight, value: values[index]?.value?.amount ?? null })),
    leftoversTo: receiver === null ? null : { campaignId: receiver.id, siteName: receiver.site.name, placementDay: dayOf(receiver.placementDay) },
    leftoversValue: value.leftovers.amount,
    netCost: value.netCost.amount,
    revenue: value.revenue.amount,
    cashedIn: value.cashedIn.amount,
    costPerBird: value.costPerBird?.amount ?? null,
    revenuePerChick: value.revenuePerChick?.amount ?? null,
    profit: value.profit.amount,
    comment: value.comment,
    // Recomputed from the journal, which no longer changes once closed (rule 8).
    feedGap: closedFeedBags(written) - (await feedBagsExpected(tx, tenantId, campaignId, campaign.placementDay, events)),
    feedGapComment: campaign.feedGapComment,
  };
}

/** The closed campaigns of the farm, the latest closed first (X.2). */
export async function closedCampaigns(tx: Tx): Promise<ClosedLotView[]> {
  const rows = await tx.campaign.findMany({ where: { closedAt: { not: null } }, orderBy: [{ closedAt: 'desc' }, { id: 'asc' }], select: { id: true, placementDay: true, closedAt: true, site: { select: { name: true } } } });
  return rows.map((row) => ({ campaignId: row.id, siteName: row.site.name, placementDay: dayOf(row.placementDay), closedAt: (row.closedAt ?? new Date(0)).toISOString() }));
}

const dayOf = (date: Date): string => date.toISOString().slice(0, 10);
