import { err, ok, type Result } from '@kit';
import type { BusinessDay } from './business-day';
import { effectiveJournal, type JournalLine } from './counter-declaration';
import type { CampaignId, UserId } from './ids';
import { isRetraction, type JournalEvent } from './journal-event';
import type { Refusal } from './refusal';

export type DayContext = { readonly campaignId: CampaignId; readonly businessDate: BusinessDay };

/** Three states that never merge: nothing said, an explicit zero, or the total of the deaths. */
export type DayMortality =
  | { readonly kind: 'NotDeclared' }
  | { readonly kind: 'NoLossDeclared' }
  | { readonly kind: 'DeathsDeclared'; readonly deaths: number };

export type DeclaredQuantity = { readonly authorId: UserId; readonly quantity: number };

/** What the caretaker sees of a day: deaths and opened bags. Losses that are not deaths stay with the admin. */
export type DaySummary = {
  readonly mortality: DayMortality;
  /** Deaths already written for the day, one total per author, in the order they first wrote. */
  readonly deaths: readonly DeclaredQuantity[];
  readonly bagsOpened: readonly DeclaredQuantity[];
};

/**
 * Sums up a day of a campaign from its effective journal. The deaths of a day add up — a
 * caretaker may declare at every round — and they prevail over a "nothing lost" of that day.
 */
export const summarizeDay = (events: readonly JournalEvent[], day: DayContext): DaySummary => {
  const lines = linesOf(events, day);
  const deaths = totalsByAuthor(lines, 'Death');
  const total = deaths.reduce((sum, entry) => sum + entry.quantity, 0);
  const mortality: DayMortality =
    deaths.length > 0
      ? { kind: 'DeathsDeclared', deaths: total }
      : lines.some((line) => line.fact.type === 'NoLoss')
        ? { kind: 'NoLossDeclared' }
        : { kind: 'NotDeclared' };
  return { mortality, deaths, bagsOpened: totalsByAuthor(lines, 'BagOpened') };
};

export type DeclaredBefore = {
  /** What the author already wrote that day, `null` when nothing: an absence is not a zero. */
  readonly byAuthor: number | null;
  readonly byOthers: readonly DeclaredQuantity[];
};

/** What is already written of a type for the day, split between the author about to declare and the others. */
export const declaredBefore = (summary: DaySummary, type: 'Death' | 'BagOpened', authorId: UserId): DeclaredBefore => {
  const entries = type === 'Death' ? summary.deaths : summary.bagsOpened;
  return {
    byAuthor: entries.find((entry) => entry.authorId === authorId)?.quantity ?? null,
    byOthers: entries.filter((entry) => entry.authorId !== authorId),
  };
};

/**
 * Refuses "nothing lost" for a day on which deaths were already written. Judged, like every
 * declaration, at the instant it was written: deaths written later that day do not refuse it,
 * they prevail in the summary.
 */
export const validateAgainstDay = <Event extends JournalEvent>(
  event: Event,
  journal: readonly JournalEvent[],
): Result<Event, Refusal> => {
  if (isRetraction(event) || event.type !== 'NoLoss') {
    return ok(event);
  }
  const deathsWrittenBefore = linesOf(journal, event).some(
    (line) => line.fact.type === 'Death' && line.declaration.recordedAt < event.recordedAt,
  );
  return deathsWrittenBefore ? err({ kind: 'NoLossAfterDeaths' }) : ok(event);
};

type StandingLine = Extract<JournalLine, { readonly retraction: null }>;

// The lines of the day that still count: a retracted declaration says nothing of its day.
function linesOf(events: readonly JournalEvent[], day: DayContext): StandingLine[] {
  return effectiveJournal(events).filter(
    (line): line is StandingLine =>
      line.retraction === null &&
      line.declaration.campaignId === day.campaignId &&
      line.declaration.businessDate === day.businessDate,
  );
}

function totalsByAuthor(lines: readonly StandingLine[], type: 'Death' | 'BagOpened'): DeclaredQuantity[] {
  const totals = new Map<UserId, number>();
  for (const { declaration, fact } of lines) {
    if (fact.type === type) {
      totals.set(declaration.authorId, (totals.get(declaration.authorId) ?? 0) + fact.quantity);
    }
  }
  return [...totals].map(([authorId, quantity]) => ({ authorId, quantity }));
}
