import { unwrap } from '@kit';
import {
  campaignDay,
  CampaignId,
  computeLiveCount,
  feedConsumption,
  mortality,
  recentBusinessDays,
  STRAINS,
  TimeZone,
  weightCurve,
  type BusinessDay,
  type OrderLineId,
  type TenantId,
} from '@domain/journal';
import type { Prisma } from '@prisma/client';
import type { TrackingView } from '@contracts';
import { campaignMoney } from '../costs/costs';
import { PrismaJournal } from '../journal/prisma-journal';
import { campaignSales } from '../sales/sales';

type Tx = Prisma.TransactionClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The « Suivi » of a lot (V.3; CdC « L'onglet Suivi d'un lot »): every figure recomputed from the
 * journal, the costs and the sales — cost per bird, mortality, days, feed (V.1), the weight curve
 * (V.2), and the sales from the first one. `null` when the campaign is not the farm's.
 */
export async function campaignTracking(tx: Tx, tenantId: TenantId, campaignId: string, now: Date): Promise<TrackingView | null> {
  const campaign = UUID.test(campaignId)
    ? await tx.campaign.findUnique({ where: { id: campaignId }, select: { placementDay: true, plannedDuration: true, strain: true, site: { select: { timeZone: true } } } })
    : null;
  if (campaign === null) return null;
  const [money, sales, events, chickLines, saleRows] = await Promise.all([
    campaignMoney(tx, tenantId, campaignId),
    campaignSales(tx, tenantId, campaignId),
    new PrismaJournal(tx, tenantId).campaignJournal(campaignId),
    tx.orderLine.findMany({ where: { order: { campaignId }, costType: { category: 'Chicks' } }, select: { id: true } }),
    tx.sale.findMany({ where: { campaignId }, select: { soldOn: true, birds: true } }),
  ]);
  if (money === null || sales === null) return null;

  const id = unwrap(CampaignId(campaignId));
  const placementDay = campaign.placementDay.toISOString().slice(0, 10) as BusinessDay;
  const today = recentBusinessDays(now, unwrap(TimeZone(campaign.site.timeZone))).today;
  const placementOrderLines = chickLines.map((line) => line.id as OrderLineId);
  const count = computeLiveCount(events, { campaignId: id, placementOrderLines, sold: sales.birdsSold });
  const sold = saleRows.map(({ soldOn, birds }) => ({ soldOn: soldOn.toISOString().slice(0, 10) as BusinessDay, quantity: birds }));
  const feed = feedConsumption(events, { campaignId: id, placementDay, today, placementOrderLines, sold, strain: STRAINS.find(({ code }) => code === campaign.strain) ?? null });

  return {
    campaignId,
    currency: money.currency,
    strain: campaign.strain,
    campaignDay: campaignDay(placementDay, today),
    plannedDuration: campaign.plannedDuration,
    costPerBird: money.costPerBird,
    received: count.received,
    deaths: count.deaths,
    mortality: mortality(count),
    feed,
    curve: weightCurve(events, placementDay),
    // Shown by phase: nothing of the sales before the first one (CdC « Suivi »).
    sales: sales.birdsSold === 0 ? null : { margin: sales.margin, averagePrice: sales.averagePrice, remaining: sales.remaining },
  };
}
