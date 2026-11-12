import type { CurrencyCode } from '@kit';
import { leftoverValues, type LeftoverValue, type ReceivedStock } from '@domain/finance';
import type { Leftover, TenantId } from '@domain/journal';
import type { Prisma } from '@prisma/client';
import { receivedStockOf } from '../orders/orders';

type Tx = Prisma.TransactionClient;

/** A leftover as written at the closing, with the name and category of its type. */
export type WrittenLeftover = Leftover & { readonly name: string; readonly category: string };

/** The leftovers written at the closing of a campaign (X.2); none before. */
export async function writtenLeftovers(tx: Tx, campaignId: string): Promise<WrittenLeftover[]> {
  const rows = await tx.campaignLeftover.findMany({ where: { campaignId }, orderBy: { costTypeId: 'asc' }, select: { costTypeId: true, whole: true, opened: true, costType: { select: { name: true, category: true } } } });
  return rows.map(({ costTypeId, whole, opened, costType }) => ({
    costTypeId,
    whole,
    opened,
    // Feed and bedding by the bag, the rest by the unit (X.1).
    unit: costType.category === 'Feed' || costType.category === 'Bedding' ? 'bag' : 'unit',
    name: costType.name,
    category: costType.category,
  }));
}

/**
 * The value of the leftovers of a campaign (X.1): at the average price it paid for each type,
 * counting what it received itself from earlier campaigns at their value. Recomputed every time
 * (rule 8): a delivery corrected after the closing changes it on both sides.
 */
export async function leftoverValuesOf(tx: Tx, tenantId: TenantId, campaignId: string, currency: CurrencyCode): Promise<LeftoverValue[]> {
  const leftovers = await writtenLeftovers(tx, campaignId);
  if (leftovers.length === 0) return [];
  const stock = [...(await receivedStockOf(tx, tenantId, campaignId)), ...(await leftoversReceived(tx, tenantId, campaignId, currency))];
  return leftoverValues(leftovers, stock, currency);
}

/**
 * What a campaign received from the campaigns closed into it (X.2), as stock at its known value:
 * it enters its committed cost. The chain ends: leftovers only go to a campaign not closed yet.
 */
export async function leftoversReceived(tx: Tx, tenantId: TenantId, campaignId: string, currency: CurrencyCode): Promise<ReceivedStock[]> {
  const givers = await tx.campaign.findMany({ where: { leftoversTo: campaignId }, orderBy: { id: 'asc' }, select: { id: true } });
  const stock: ReceivedStock[] = [];
  for (const giver of givers) {
    for (const { costTypeId, halves, value } of await leftoverValuesOf(tx, tenantId, giver.id, currency)) {
      if (value !== null) stock.push({ costTypeId, halves, value });
    }
  }
  return stock;
}
