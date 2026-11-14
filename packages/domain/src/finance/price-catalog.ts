import type { Money } from '@kit';

/**
 * A price the farm knows for an article (N.5): paid on an order line to a supplier, or set by
 * the admin — for one supplier, or for all (`supplierId: null`) — at a moment in UTC.
 */
export type KnownPrice = {
  readonly costTypeId: string;
  readonly supplierId: string | null;
  readonly unitPrice: Money;
  readonly at: string;
};

/**
 * The price an order proposes for an article (N.5, decisions of 2026-11-13): the latest known
 * for this supplier; failing that, the latest known for the article, whoever sold it; failing
 * that, none — the box stays empty, never 0. A proposal only: the admin writes what he wants.
 */
export function suggestedPrice(prices: readonly KnownPrice[], costTypeId: string, supplierId: string | null): Money | null {
  const ofArticle = prices.filter((price) => price.costTypeId === costTypeId);
  const latest = (candidates: readonly KnownPrice[]): Money | null =>
    candidates.reduce<KnownPrice | null>((best, price) => (best === null || price.at > best.at || (price.at === best.at && price.unitPrice.amount > best.unitPrice.amount) ? price : best), null)?.unitPrice ?? null;
  const ofSupplier = supplierId === null ? [] : ofArticle.filter((price) => price.supplierId === supplierId);
  return latest(ofSupplier) ?? latest(ofArticle);
}

/** How far from the known price a typed one must be to be read again (Q.13): three times less or more. */
const UNUSUAL_FACTOR = 3;

/**
 * A price to read again (Q.13): more than three times below or above the price known for the
 * article — a quantity and a price typed the wrong way round, a zero forgotten. It warns, never
 * blocks: the admin writes the price he pays. Nothing known, or a gift (zero), compares to nothing.
 */
export function unusualPrice(typed: Money, known: Money | null): boolean {
  if (known === null || known.amount === 0) return false;
  return typed.amount * UNUSUAL_FACTOR < known.amount || typed.amount > known.amount * UNUSUAL_FACTOR;
}
