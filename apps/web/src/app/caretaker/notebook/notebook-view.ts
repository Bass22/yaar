import {
  campaignDay,
  CounterDeclaration,
  Declaration,
  effectiveJournal,
  recentBusinessDays,
  Retraction,
  summarizeDay,
  type BusinessDay,
  type CampaignId,
  type DaySummary,
  type EventEnvelope,
  type Fact,
  type JournalEvent,
  type JournalEventId,
  type TimeZone,
} from '@domain/journal';
import type { CaretakerCampaign, CaretakerJournalLine, FactPayload } from '@contracts';
import type { OutboxEntry } from '../../core/outbox/outbox';

// What the notebook shows, computed from the last context the server sent and from what the
// phone keeps in its outbox — with the field rules of @domain/journal, never rewritten here.

/** A campaign running on the site, as the caretaker tells it from the others (decisions of 2026-11-07). */
export type NotebookCampaign = {
  readonly campaignId: string;
  /** « Les petits », « Les grands » for two campaigns; « Jour 12 » beyond two; `null` alone — no choice to make. */
  readonly name: string | null;
  readonly picto: 'chick' | 'hen';
  readonly tone: 'young' | 'old';
  /** Day J on the phone's today: J0 is the placement. */
  readonly campaignDay: number;
};

/**
 * The campaigns of the site, youngest first. Two campaigns are « les petits » and « les grands »;
 * beyond two, each is called by its age (decision of 2026-11-07). The youngest wears the chick.
 */
export function campaignsOf(campaigns: readonly CaretakerCampaign[], today: BusinessDay): NotebookCampaign[] {
  const youngestFirst = [...campaigns].sort((a, b) => (a.placementDay === b.placementDay ? a.campaignId.localeCompare(b.campaignId) : a.placementDay < b.placementDay ? 1 : -1));
  return youngestFirst.map((campaign, rank) => {
    const day = campaignDay(campaign.placementDay as BusinessDay, today);
    const name = youngestFirst.length === 1 ? null : youngestFirst.length === 2 ? (rank === 0 ? 'Les petits' : 'Les grands') : `Jour ${day}`;
    return { campaignId: campaign.campaignId, name, picto: rank === 0 ? 'chick' : 'hen', tone: rank === 0 ? 'young' : 'old', campaignDay: day };
  });
}

/** The three days a caretaker writes for, from the phone's clock and the site's time zone. */
export type NotebookDay = { readonly day: BusinessDay; readonly when: 'today' | 'yesterday' | 'dayBeforeYesterday' };

/** The day before yesterday, yesterday, today: the order of the tabs. */
export function daysOf(now: Date, timeZone: TimeZone): NotebookDay[] {
  const { today, yesterday, dayBeforeYesterday } = recentBusinessDays(now, timeZone);
  return [
    { day: dayBeforeYesterday, when: 'dayBeforeYesterday' },
    { day: yesterday, when: 'yesterday' },
    { day: today, when: 'today' },
  ];
}

type Where = { readonly tenantId: string; readonly siteId: string };

/**
 * The journal of a campaign as the phone knows it: the lines the server sent — taken back ones
 * aside, they count for nothing — then everything the outbox keeps for it, sent or not. An event
 * the server already sent back counts once: the journal keeps the first received of an identifier.
 */
export function journalOf(campaign: CaretakerCampaign, entries: readonly OutboxEntry[], where: Where): JournalEvent[] {
  const fromServer = campaign.journal
    .filter((line) => !line.retracted)
    .map((line) => Declaration(envelopeOf({ id: line.id, authorId: line.author.id, campaignId: campaign.campaignId, businessDate: line.businessDate, recordedAt: line.recordedAt }, where), factFrom(line.fact)));
  // A line the admin took back stays taken back, even though the phone still keeps it as sent.
  const takenBack = new Set(campaign.journal.filter((line) => line.retracted).map((line) => line.id));
  const fromPhone = entries.filter((entry) => entry.payload.campaignId === campaign.campaignId && !takenBack.has(entry.id)).map((entry) => eventOf(entry, where));
  return [...fromServer, ...fromPhone];
}

/** The mini-summary of each day's tab: nothing said, an explicit zero, or the deaths — and the bags. */
export function summaryOf(journal: readonly JournalEvent[], campaignId: string, day: BusinessDay): DaySummary {
  return summarizeDay(journal, { campaignId: campaignId as CampaignId, businessDate: day });
}

/** A line of the day's journal, as written in the notebook. */
export type NotebookLine = {
  readonly id: string;
  readonly recordedAt: string;
  readonly authorId: string;
  /** What counts; for a line taken back, what had been declared. */
  readonly fact: FactPayload;
  readonly corrected: boolean;
  readonly retracted: boolean;
  /** Still on the phone, or a correction of it is: the waiting stamp instead of « bien envoyé ». */
  readonly waiting: boolean;
};

/** The journal of one day, the latest written on top — the server's lines with the phone's. */
export function linesOf(campaign: CaretakerCampaign, journal: readonly JournalEvent[], entries: readonly OutboxEntry[], day: BusinessDay): NotebookLine[] {
  const waiting = new Set(entries.filter((entry) => entry.state === 'pending' || entry.state === 'in-doubt').map((entry) => entry.id));
  const correctedByServer = new Set(campaign.journal.filter((line) => line.corrected).map((line) => line.id));
  const standing: NotebookLine[] = effectiveJournal(journal)
    .filter((line) => line.declaration.businessDate === day && line.declaration.type !== 'Loss')
    .map((line) => ({
      id: line.declaration.id,
      recordedAt: line.declaration.recordedAt,
      authorId: line.declaration.authorId,
      fact: (line.fact ?? line.declaration) as unknown as FactPayload,
      corrected: line.correction !== null || correctedByServer.has(line.declaration.id),
      retracted: line.retraction !== null,
      waiting: waiting.has(line.declaration.id) || (line.correction !== null && waiting.has(line.correction.id)),
    }));
  const takenBack: NotebookLine[] = campaign.journal.filter((line) => line.retracted && line.businessDate === day).map(retractedLine);
  return [...standing, ...takenBack].sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : a.recordedAt > b.recordedAt ? -1 : 0));
}

function retractedLine(line: CaretakerJournalLine): NotebookLine {
  return { id: line.id, recordedAt: line.recordedAt, authorId: line.author.id, fact: line.fact, corrected: line.corrected, retracted: true, waiting: false };
}

// The phone's own outbox and the server's answer were checked by the field rules where they
// were written: they are read back here as they are, not decoded a second time.
function eventOf(entry: OutboxEntry, where: Where): JournalEvent {
  const { payload } = entry;
  const envelope = envelopeOf({ id: payload.id, authorId: entry.authorId, campaignId: payload.campaignId, businessDate: payload.businessDate, recordedAt: payload.recordedAt }, where);
  if ('retracts' in payload) {
    return Retraction(envelope, payload.retracts as JournalEventId);
  }
  if ('corrects' in payload) {
    return CounterDeclaration(envelope, payload.corrects as JournalEventId, factFrom(payload.fact));
  }
  return Declaration(envelope, factFrom(payload.fact));
}

type EnvelopeFields = { readonly id: string; readonly authorId: string; readonly campaignId: string; readonly businessDate: string; readonly recordedAt: string };

function envelopeOf(fields: EnvelopeFields, where: Where): EventEnvelope {
  return { ...fields, tenantId: where.tenantId, siteId: where.siteId } as unknown as EventEnvelope;
}

function factFrom(payload: FactPayload): Fact {
  return payload as unknown as Fact;
}
