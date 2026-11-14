import { BAG_WEIGHT, type FeedLine, type OrderLineId } from '@domain/journal';
import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

/** What the feed of a campaign weighs, as the journal cannot tell it: its bags ordered, and those left to it. */
export type FeedContext = {
  /** The feed lines of its orders: the weight of their bags (N.8b). */
  readonly feedLines: readonly FeedLine[];
  /** Every bag left to it by earlier campaigns, by weight, opened first (N.8b): a whole one at its type's usual weight, one opened at its grams left, else half. */
  readonly carriedOver: readonly number[];
  /** Only the whole bags left to it: those it should still find closed, unless opened (N.8d). */
  readonly carriedClosed: readonly number[];
};

export async function feedContextOf(tx: Tx, campaignId: string): Promise<FeedContext> {
  const [lines, carried] = await Promise.all([
    tx.orderLine.findMany({ where: { order: { campaignId }, costType: { category: 'Feed' } }, select: { id: true, bagWeight: true, costType: { select: { bagWeight: true } } } }),
    tx.campaignLeftover.findMany({
      where: { campaign: { leftoversTo: campaignId }, costType: { category: 'Feed' } },
      orderBy: [{ campaign: { closedAt: 'asc' } }, { costTypeId: 'asc' }],
      select: { whole: true, opened: true, openedWeight: true, costType: { select: { bagWeight: true } } },
    }),
  ]);
  const wholeOf = carried.map(({ whole, costType }) => Array.from({ length: whole }, () => costType.bagWeight ?? BAG_WEIGHT));
  return {
    feedLines: lines.map((line) => ({ orderLineId: line.id as OrderLineId, bagWeight: line.bagWeight ?? line.costType.bagWeight ?? BAG_WEIGHT, usualWeight: line.costType.bagWeight })),
    carriedOver: carried.flatMap(({ opened, openedWeight, costType }, index) => [...(wholeOf[index] ?? []), ...(opened ? [openedWeight ?? (costType.bagWeight ?? BAG_WEIGHT) / 2] : [])]),
    carriedClosed: wholeOf.flat(),
  };
}
