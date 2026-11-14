import { unwrap } from '@kit';
import { campaignDay,
  CampaignId,
  computeLiveCount,
  feedConsumption,
  mortality,
  recentBusinessDays,
  strainOf,
  TimeZone,
  weightCurve,
  type BusinessDay,
  type TenantId, isCanonicalUuid } from '@domain/journal';
import type { Prisma } from '@prisma/client';
import type { TrackingView } from '@contracts';
import { campaignMoney } from '../costs/costs';
import { PrismaJournal } from '../journal/prisma-journal';
import { campaignSales } from '../sales/sales';
import { feedContextOf } from './feed';
import { writtenLeftovers } from './leftovers';
import { placementOrderLinesOf } from '../journal/birds';

type Tx = Prisma.TransactionClient;

/**
 * The « Suivi » of a lot (V.3; CdC « L'onglet Suivi d'un lot »): every figure recomputed from the
 * journal, the costs and the sales — cost per bird, mortality, days, feed (V.1), the weight curve
 * (V.2), and the sales from the first one. `null` when the campaign is not the farm's.
 */
export async function campaignTracking(tx: Tx, tenantId: TenantId, campaignId: string, now: Date): Promise<TrackingView | null> {
  const campaign = isCanonicalUuid(campaignId)
    ? await tx.campaign.findUnique({ where: { id: campaignId }, select: { placementDay: true, plannedDuration: true, strain: true, site: { select: { timeZone: true } } } })
    : null;
  if (campaign === null) return null;
  const [money, sales, events, chickLines, saleRows, leftovers, feedContext] = await Promise.all([
    campaignMoney(tx, tenantId, campaignId),
    campaignSales(tx, tenantId, campaignId),
    new PrismaJournal(tx, tenantId).campaignJournal(campaignId),
    placementOrderLinesOf(tx, campaignId),
    tx.sale.findMany({ where: { campaignId }, select: { soldOn: true, birds: true } }),
    writtenLeftovers(tx, campaignId),
    feedContextOf(tx, campaignId),
  ]);
  if (money === null || sales === null) return null;

  const id = unwrap(CampaignId(campaignId));
  const placementDay = campaign.placementDay.toISOString().slice(0, 10) as BusinessDay;
  const today = recentBusinessDays(now, unwrap(TimeZone(campaign.site.timeZone))).today;
  const placementOrderLines = chickLines;
  const count = computeLiveCount(events, { campaignId: id, placementOrderLines, sold: sales.birdsSold });
  const sold = saleRows.map(({ soldOn, birds }) => ({ soldOn: soldOn.toISOString().slice(0, 10) as BusinessDay, quantity: birds }));
  const feed = feedConsumption(events, { campaignId: id, placementDay, today, placementOrderLines, sold, strain: strainOf(campaign.strain),
    // The bags of feed left opened at the closing: their grams left were not eaten, else half (X.2, N.8d).
    openedFeedLeft: leftovers.filter(({ category, opened }) => category === 'Feed' && opened).map(({ openedWeight }) => openedWeight),
    feedLines: feedContext.feedLines,
    carriedOver: feedContext.carriedOver,
  });

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
