import { err, Money, ok, unwrap, type CurrencyCode, type Result } from '@kit';
import { closingReport, NOTE_MAX_LENGTH, transferLeftovers } from '@domain/finance';
import { CampaignId, computeLiveCount, recordLeftovers, type OrderLineId, type TenantId } from '@domain/journal';
import type { Prisma } from '@prisma/client';
import type { CampaignClosingRefusal, ClosedLotView, CloseCampaignRequest, ClosingReportView } from '@contracts';
import { recordAudit } from '../audit/audit';
import type { Session } from '../auth/session';
import { campaignMoney } from '../costs/costs';
import { PrismaJournal } from '../journal/prisma-journal';
import { campaignSales } from '../sales/sales';
import { leftoverValuesOf, writtenLeftovers } from './leftovers';

type Tx = Prisma.TransactionClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The admin closes a campaign (X.2; CdC « Les restes et le bilan »), online and at once: its
 * leftovers — or none —, the campaign of the same site that receives them, and the comment of its
 * report. Nothing is erased; the closing date stops every new entry. Traced.
 */
export async function closeCampaign(tx: Tx, admin: Session, campaignId: string, request: CloseCampaignRequest, now: Date): Promise<Result<void, CampaignClosingRefusal>> {
  const campaign = UUID.test(campaignId) ? await tx.campaign.findUnique({ where: { id: campaignId }, select: { siteId: true, closedAt: true } }) : null;
  if (campaign === null) return err({ kind: 'CampaignNotFound' });
  if (campaign.closedAt !== null) return err({ kind: 'CampaignClosed' });

  const ids = request.leftovers.map(({ costTypeId }) => costTypeId);
  const malformed = ids.find((id) => !UUID.test(id));
  if (malformed !== undefined) return err({ kind: 'InvalidId', costTypeId: malformed });
  const types = new Map((await tx.costType.findMany({ where: { id: { in: ids } }, select: { id: true, category: true } })).map(({ id, category }) => [id, category]));
  const unknown = ids.find((id) => !types.has(id));
  if (unknown !== undefined) return err({ kind: 'UnknownCostType', costTypeId: unknown });
  const leftovers = recordLeftovers(request.leftovers.map((leftover) => ({ ...leftover, category: types.get(leftover.costTypeId) ?? '' })));
  if (!leftovers.ok) return err(leftovers.error);

  let leftoversTo: string | null = null;
  if (leftovers.value.length > 0) {
    if (request.leftoversTo === null) return err({ kind: 'LeftoversWithoutReceiver' });
    const receiver = UUID.test(request.leftoversTo) ? await tx.campaign.findUnique({ where: { id: request.leftoversTo }, select: { siteId: true, closedAt: true } }) : null;
    if (receiver === null) return err({ kind: 'UnknownReceiver' });
    // The domain judges the receiver; the value moves by itself, recomputed on both sides (rule 8).
    const { currency } = await tx.tenant.findUniqueOrThrow({ where: { id: admin.tenantId }, select: { currency: true } });
    const transfer = transferLeftovers([], { from: { campaignId, siteId: campaign.siteId }, to: { campaignId: request.leftoversTo, siteId: receiver.siteId, closed: receiver.closedAt !== null } }, currency as CurrencyCode);
    if (!transfer.ok) return err(transfer.error);
    leftoversTo = request.leftoversTo;
  }

  const comment = request.comment?.trim() ?? '';
  if (comment.length > NOTE_MAX_LENGTH) return err({ kind: 'CommentTooLong', max: NOTE_MAX_LENGTH });

  // Closed once: a closing that raced this one finds the campaign closed and writes nothing.
  const closed = await tx.campaign.updateMany({ where: { id: campaignId, closedAt: null }, data: { closedAt: now, leftoversTo, closingComment: comment === '' ? null : comment } });
  if (closed.count === 0) return err({ kind: 'CampaignClosed' });
  await tx.campaignLeftover.createMany({ data: leftovers.value.map(({ costTypeId, whole, opened }) => ({ tenantId: admin.tenantId, campaignId, costTypeId, whole, opened })) });
  await recordAudit(tx, admin.tenantId, { action: 'CampaignClosed', actorId: admin.userId, subjectId: campaignId, siteId: campaign.siteId, deviceId: admin.deviceId }, now);
  return ok(undefined);
}

/**
 * The report of a closed campaign (X.1, X.2), recomputed from the entries every time: only the
 * leftovers and the comment were written at the closing. `null` while it runs — the report exists
 * only at the closing — or when it is not the farm's.
 */
export async function campaignClosingReport(tx: Tx, tenantId: TenantId, campaignId: string): Promise<ClosingReportView | null> {
  const campaign = UUID.test(campaignId)
    ? await tx.campaign.findUnique({
        where: { id: campaignId },
        select: { placementDay: true, closedAt: true, closingComment: true, site: { select: { name: true } }, receiver: { select: { id: true, placementDay: true, site: { select: { name: true } } } } },
      })
    : null;
  if (campaign === null || campaign.closedAt === null) return null;
  const [money, sales, events, chickLines, written] = await Promise.all([
    campaignMoney(tx, tenantId, campaignId),
    campaignSales(tx, tenantId, campaignId),
    new PrismaJournal(tx, tenantId).campaignJournal(campaignId),
    tx.orderLine.findMany({ where: { order: { campaignId }, costType: { category: 'Chicks' } }, select: { id: true } }),
    writtenLeftovers(tx, campaignId),
  ]);
  if (money === null || sales === null) return null;
  const currency = money.currency as CurrencyCode;
  const values = await leftoverValuesOf(tx, tenantId, campaignId, currency);
  const transferred = values.reduce((sum, { value }) => sum + (value?.amount ?? 0), 0);
  const count = computeLiveCount(events, { campaignId: unwrap(CampaignId(campaignId)), placementOrderLines: chickLines.map(({ id }) => id as OrderLineId), sold: sales.birdsSold });
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
    leftovers: written.map((leftover, index) => ({ costTypeId: leftover.costTypeId, name: leftover.name, unit: leftover.unit, whole: leftover.whole, opened: leftover.opened, value: values[index]?.value?.amount ?? null })),
    leftoversTo: receiver === null ? null : { campaignId: receiver.id, siteName: receiver.site.name, placementDay: dayOf(receiver.placementDay) },
    leftoversValue: value.leftovers.amount,
    netCost: value.netCost.amount,
    revenue: value.revenue.amount,
    cashedIn: value.cashedIn.amount,
    costPerBird: value.costPerBird?.amount ?? null,
    revenuePerChick: value.revenuePerChick?.amount ?? null,
    profit: value.profit.amount,
    comment: value.comment,
  };
}

/** The closed campaigns of the farm, the latest closed first (X.2). */
export async function closedCampaigns(tx: Tx): Promise<ClosedLotView[]> {
  const rows = await tx.campaign.findMany({ where: { closedAt: { not: null } }, orderBy: [{ closedAt: 'desc' }, { id: 'asc' }], select: { id: true, placementDay: true, closedAt: true, site: { select: { name: true } } } });
  return rows.map((row) => ({ campaignId: row.id, siteName: row.site.name, placementDay: dayOf(row.placementDay), closedAt: (row.closedAt ?? new Date(0)).toISOString() }));
}

const dayOf = (date: Date): string => date.toISOString().slice(0, 10);
