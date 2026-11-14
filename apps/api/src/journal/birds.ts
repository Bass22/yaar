import { unwrap } from '@kit';
import { CampaignId, computeLiveCount, type JournalEvent, type OrderLineId } from '@domain/journal';
import type { Prisma } from '@prisma/client';

/**
 * The order lines that deliver the animals placed (`placementOrderLines`): today the chick lines.
 * The one place that says which lines count as placed — the definition a new species changes (CLAUDE.md §5).
 */
export async function placementOrderLinesOf(tx: Prisma.TransactionClient, campaignId: string): Promise<OrderLineId[]> {
  const lines = await tx.orderLine.findMany({ where: { order: { campaignId }, costType: { category: 'Chicks' } }, select: { id: true } });
  return lines.map(({ id }) => id as OrderLineId);
}

/** The chicks received on the campaign's placement lines, and the birds alive — `null` until a chick is received (Q.7). */
export async function birdsOf(tx: Prisma.TransactionClient, campaignId: string, events: readonly JournalEvent[]): Promise<{ received: number; liveCount: number | null }> {
  const placementOrderLines = await placementOrderLinesOf(tx, campaignId);
  // Birds sold leave the flock (W.1): a number only reaches the phone, never a sale.
  const sold = (await tx.sale.aggregate({ where: { campaignId }, _sum: { birds: true } }))._sum.birds ?? 0;
  const count = computeLiveCount(events, { campaignId: unwrap(CampaignId(campaignId)), placementOrderLines, sold });
  return { received: count.received, liveCount: count.received > 0 ? count.liveCount : null };
}
