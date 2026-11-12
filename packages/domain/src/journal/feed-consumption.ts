import { campaignDay, type BusinessDay } from './business-day';
import { effectiveJournal } from './counter-declaration';
import type { CampaignId, OrderLineId } from './ids';
import type { JournalEvent } from './journal-event';
import { targetAt, type Strain } from './strain';
import { weightCurve } from './weighing';

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
  readonly openedFeedBagsLeft?: number;
};

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
  const add = (days: Map<number, number>, day: number, count: number) => days.set(day, (days.get(day) ?? 0) + count);

  for (const { declaration, fact } of effectiveJournal(events)) {
    if (fact === null || declaration.campaignId !== context.campaignId) continue;
    const day = campaignDay(context.placementDay, declaration.businessDate);
    if (fact.type === 'Delivery' && context.placementOrderLines.includes(fact.orderLineId)) add(received, day, fact.receivedQuantity);
    else if (fact.type === 'Death' || fact.type === 'Loss') add(leaving, day, fact.quantity);
    else if (fact.type === 'BagOpened') add(bags, day, fact.quantity);
  }
  for (const { soldOn, quantity } of context.sold) add(leaving, campaignDay(context.placementDay, soldOn), quantity);

  // The bag left opened is the last one opened: its half not eaten leaves that day.
  const lastBagDay = Math.max(...bags.keys());
  const notEaten = (context.openedFeedBagsLeft ?? 0) / 2;

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
      const opened = (bags.get(day) ?? 0) - (day === lastBagDay ? notEaten : 0);
      if (opened > 0 && alive > 0) eaten += (opened * BAG_WEIGHT) / alive;
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
