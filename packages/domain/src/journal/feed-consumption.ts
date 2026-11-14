import { campaignDay, type BusinessDay } from './business-day';
import { effectiveJournal } from './counter-declaration';
import type { CampaignId, OrderLineId } from './ids';
import type { JournalEvent } from './journal-event';
import { targetAt, type Strain } from './strain';
import { weightCurve } from './weighing';
import { inWritingOrder } from './counter-declaration';

/** One bag of feed, in grams: 50 kg for every farm (decision of 2026-11-12). */
export const BAG_WEIGHT = 50_000;

/** Birds sold on a day, as the journal sees a sale: a day and a number — never an amount. */
export type SoldBirds = { readonly soldOn: BusinessDay; readonly quantity: number };

export type FeedConsumptionContext = {
  readonly campaignId: CampaignId;
  readonly placementDay: BusinessDay;
  readonly today: BusinessDay;
  /** The order lines that deliver the animals placed: the journal cannot tell them from feed. */
  readonly placementOrderLines: readonly OrderLineId[];
  readonly sold: readonly SoldBirds[];
  readonly strain: Strain | null;
  /**
   * Bags of feed left opened at the closing (X.2): their half not eaten, 25 kg each, leaves the day
   * the last bag was opened (decision of 2026-11-12). None before the closing.
   */
  readonly openedFeedLeft?: readonly (number | null)[];
  /**
   * The feed lines of the campaign's orders (N.8b): the weight of their bags, in grams, and the usual
   * weight of their type — what a bag opened without a received bag waiting counts.
   */
  readonly feedLines?: readonly FeedLine[];
  /** Bags of feed left by an earlier campaign, by weight in grams: opened first (N.8b). */
  readonly carriedOver?: readonly number[];
};

/** A feed line of an order, as the feed eaten reads it: what each of its bags weighs. */
export type FeedLine = { readonly orderLineId: OrderLineId; readonly bagWeight: number; readonly usualWeight: number | null };

export type FeedConsumption = {
  /** Bags opened, as the journal counts them. */
  readonly bagsOpened: number;
  /** Grams eaten per bird so far, the sum of the days; `null` while no chick is received. */
  readonly cumulative: number | null;
  /** The strain's cumulative feed at today's age; `null` where its table gives none. */
  readonly target: number | null;
  /** `cumulative − target`, signed: above zero, more eaten than the table. */
  readonly variance: number | null;
  /** On the latest validated weighing: feed per bird to its day ÷ its average weight, to the thousandth. */
  readonly feedConversion: { readonly campaignDay: number; readonly value: number; readonly target: number | null } | null;
};

/**
 * The feed eaten by a flock (V.1; CdC « La consommation d'aliment », decisions of 2026-11-12): each
 * day, the bags opened × 50 kg ÷ the birds alive that day — chicks received up to that day, less the
 * deaths, losses and sales of the days before —, summed. A day without birds alive divides by
 * nothing and does not count. No daily figure: bags are not opened at the pace of the meals.
 */
export function feedConsumption(events: readonly JournalEvent[], context: FeedConsumptionContext): FeedConsumption {
  const received = new Map<number, number>();
  const leaving = new Map<number, number>();
  const bags = new Map<number, number>();
  const receipts: Receipt[] = [];
  const add = (days: Map<number, number>, day: number, count: number) => days.set(day, (days.get(day) ?? 0) + count);

  for (const { declaration, fact } of effectiveJournal(events)) {
    if (fact === null || declaration.campaignId !== context.campaignId) continue;
    const day = campaignDay(context.placementDay, declaration.businessDate);
    const feedLine = fact.type === 'Delivery' ? context.feedLines?.find((line) => line.orderLineId === fact.orderLineId) : undefined;
    if (fact.type === 'Delivery' && context.placementOrderLines.includes(fact.orderLineId)) add(received, day, fact.receivedQuantity);
    else if (fact.type === 'Delivery' && feedLine !== undefined) receipts.push({ day, recordedAt: declaration.recordedAt, id: declaration.id, count: fact.receivedQuantity, line: feedLine });
    else if (fact.type === 'Death' || fact.type === 'Loss') add(leaving, day, fact.quantity);
    else if (fact.type === 'BagOpened') add(bags, day, fact.quantity);
  }
  for (const { soldOn, quantity } of context.sold) add(leaving, campaignDay(context.placementDay, soldOn), quantity);

  const { grams, opened } = firstInFirstOut(receipts, bags, context.carriedOver ?? []);
  // The bags left opened are the last ones opened: half of each one's weight leaves that day.
  const lastBagDay = Math.max(...bags.keys());
  // Each one leaves the grams known to be left in it (N.8d), else half its weight.
  const left = context.openedFeedLeft ?? [];
  const notEaten = opened.slice(opened.length - Math.min(left.length, opened.length)).reduce((sum, weight, index) => sum + (left[index] ?? weight / 2), 0);

  /** Grams eaten per bird from the first day to `lastDay` included; `null` while no chick is received by then. */
  const eatenTo = (lastDay: number): number | null => {
    const days = [...new Set([...received.keys(), ...leaving.keys(), ...bags.keys()])].filter((day) => day <= lastDay).sort((a, b) => a - b);
    let alive = 0;
    let anyReceived = false;
    let eaten = 0;
    for (const day of days) {
      // The birds alive on a day: received up to it included, less those that left on the days before.
      alive += received.get(day) ?? 0;
      anyReceived ||= received.has(day);
      const gramsOpened = (grams.get(day) ?? 0) - (day === lastBagDay ? notEaten : 0);
      if (gramsOpened > 0 && alive > 0) eaten += gramsOpened / alive;
      alive -= leaving.get(day) ?? 0;
    }
    return anyReceived ? Math.round(eaten) : null;
  };

  const today = campaignDay(context.placementDay, context.today);
  const cumulative = eatenTo(today);
  const target = context.strain === null ? null : (targetAt(context.strain, today)?.cumulativeFeed ?? null);
  return {
    bagsOpened: [...bags.values()].reduce((sum, count) => sum + count, 0),
    cumulative,
    target,
    variance: cumulative === null || target === null ? null : cumulative - target,
    feedConversion: feedConversionOf(events, context, eatenTo),
  };
}

/**
 * The bags of feed that should still be closed (N.8d): received and left by earlier campaigns,
 * less those the journal opened, all feeds together — never below zero.
 */
export function feedBagsWaiting(events: readonly JournalEvent[], context: Pick<FeedConsumptionContext, 'campaignId' | 'placementDay' | 'feedLines' | 'carriedOver'>): number {
  let waiting = context.carriedOver?.length ?? 0;
  let opened = 0;
  for (const { declaration, fact } of effectiveJournal(events)) {
    if (fact === null || declaration.campaignId !== context.campaignId) continue;
    if (fact.type === 'Delivery' && context.feedLines?.some((line) => line.orderLineId === fact.orderLineId)) waiting += fact.receivedQuantity;
    else if (fact.type === 'BagOpened') opened += fact.quantity;
  }
  return Math.max(waiting - opened, 0);
}

type Receipt = { readonly day: number; readonly recordedAt: string; readonly id: string; readonly count: number; readonly line: FeedLine };

/**
 * The weight of each bag opened (N.8b, decisions of 2026-11-13): bags open in the order they came —
 * the leftovers of an earlier campaign first, then the deliveries by day, a delivery before the
 * openings of its day. A bag opened while none waits weighs the usual weight of the last feed
 * received, else 50 kg. Gives the grams opened each day, and every bag's weight in opening order.
 */
function firstInFirstOut(receipts: readonly Receipt[], bags: ReadonlyMap<number, number>, carriedOver: readonly number[]): { grams: Map<number, number>; opened: number[] } {
  const waiting: { weight: number; count: number }[] = carriedOver.map((weight) => ({ weight, count: 1 }));
  const byArrival = [...receipts].sort((a, b) => a.day - b.day || inWritingOrder(a, b));
  const grams = new Map<number, number>();
  const opened: number[] = [];
  let next = 0;
  let fallback = BAG_WEIGHT;
  for (const day of [...bags.keys()].sort((a, b) => a - b)) {
    for (; next < byArrival.length && (byArrival[next]?.day ?? Infinity) <= day; next += 1) {
      const receipt = byArrival[next] as Receipt;
      waiting.push({ weight: receipt.line.bagWeight, count: receipt.count });
      fallback = receipt.line.usualWeight ?? BAG_WEIGHT;
    }
    for (let left = bags.get(day) ?? 0; left > 0; left -= 1) {
      const head = waiting[0];
      const weight = head === undefined ? fallback : head.weight;
      if (head !== undefined && (head.count -= 1) === 0) waiting.shift();
      opened.push(weight);
      grams.set(day, (grams.get(day) ?? 0) + weight);
    }
  }
  return { grams, opened };
}

function feedConversionOf(events: readonly JournalEvent[], context: FeedConsumptionContext, eatenTo: (lastDay: number) => number | null): FeedConsumption['feedConversion'] {
  const latest = weightCurve(
    events.filter((event) => event.campaignId === context.campaignId),
    context.placementDay,
  ).at(-1);
  if (latest === undefined) return null;
  const eaten = eatenTo(latest.campaignDay);
  if (eaten === null) return null;
  return {
    campaignDay: latest.campaignDay,
    value: Math.round((eaten / latest.average) * 1000) / 1000,
    target: context.strain === null ? null : (targetAt(context.strain, latest.campaignDay)?.feedConversion ?? null),
  };
}
