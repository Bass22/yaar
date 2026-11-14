import {
  campaignDay,
  CounterDeclaration,
  Declaration,
  effectiveJournal,
  lineDelivery,
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
  type Quantity,
  type TimeZone,
} from '@domain/journal';
import type { CaretakerCampaign, CaretakerDeliveryLine, CaretakerJournalLine, FactPayload } from '@contracts';
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

/** The days of the notebook that exist for a campaign (J.4): none before its placement — J0 shows today alone. */
export function campaignDaysOf(days: readonly NotebookDay[], placementDay: string): NotebookDay[] {
  return days.filter(({ day }) => day >= placementDay);
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

/**
 * The live count shown on the strip (K.1, Q.7): the server's, plus the chicks and less the deaths
 * the phone wrote and the server has not counted yet — not in the journal it sent. A sent one
 * whose day has left the three days of the notebook is no longer in that journal, but the server
 * has counted it. Signed, never clamped; unknown while no chick is known to be received
 * (CLAUDE.md §4 rules 9 and 10).
 */
export function liveCountOf(campaign: CaretakerCampaign, entries: readonly OutboxEntry[], oldestDay: BusinessDay): number | null {
  const chickLines = new Set(campaign.deliveries.flatMap((delivery) => delivery.lines).filter((line) => line.category === 'Chicks').map((line) => line.orderLineId));
  let chicks = 0;
  let deaths = 0;
  for (const { payload } of notCountedYet(campaign, entries, oldestDay)) {
    if (!('fact' in payload)) continue;
    if (payload.fact.type === 'Delivery' && chickLines.has(payload.fact.orderLineId)) chicks += payload.fact.receivedQuantity;
    if (payload.fact.type === 'Death') deaths += payload.fact.quantity;
  }
  if (campaign.liveCount === null && chicks === 0) {
    return null;
  }
  return (campaign.liveCount ?? 0) + chicks - deaths;
}

/**
 * The declarations of the campaign the phone wrote and the server has not counted yet — not in the
 * journal it sent. A sent one whose day has left the three days of the notebook is no longer in that
 * journal, but the server has counted it. Corrections are left out: they replace, they do not add.
 * The one reading the live count and the deliveries share.
 */
function notCountedYet(campaign: CaretakerCampaign, entries: readonly OutboxEntry[], oldestDay: BusinessDay): readonly OutboxEntry[] {
  const counted = new Set(campaign.journal.map((line) => line.id));
  return entries.filter(
    (entry) => entry.payload.campaignId === campaign.campaignId && !counted.has(entry.id) && (entry.state !== 'sent' || entry.payload.businessDate >= oldestDay) && !('corrects' in entry.payload) && 'fact' in entry.payload,
  );
}

/**
 * The deliveries the card still waits for (Q.7): the server's, less what the phone counted and
 * the server has not counted yet — the same reading as the live count. A line with nothing left
 * to come leaves the card; an order with no line left, too.
 */
export function expectedDeliveriesOf(campaign: CaretakerCampaign, entries: readonly OutboxEntry[], oldestDay: BusinessDay): CaretakerDeliveryLine[] {
  const onPhone = new Map<string, number>();
  for (const { payload } of notCountedYet(campaign, entries, oldestDay)) {
    if (!('fact' in payload)) continue;
    if (payload.fact.type === 'Delivery') onPhone.set(payload.fact.orderLineId, (onPhone.get(payload.fact.orderLineId) ?? 0) + payload.fact.receivedQuantity);
  }
  return campaign.deliveries
    .flatMap((delivery) => delivery.lines)
    .map((line) => {
      const received = line.received + (onPhone.get(line.orderLineId) ?? 0);
      return { ...line, received, remaining: lineDelivery(line.expected as Quantity, received).remaining };
    })
    .filter((line) => line.remaining > 0);
}

/**
 * The weighings the chef asked for and nobody answered yet (T.2): the server's, less those a weighing
 * kept on the phone answers — the card closes as soon as the weighing is written, offline too.
 */
export function weighingRequestsOf(campaign: CaretakerCampaign, entries: readonly OutboxEntry[], oldestDay: BusinessDay): CaretakerCampaign['weighingRequests'] {
  const answered = new Set<string>();
  for (const { state, payload } of entries) {
    if (payload.campaignId !== campaign.campaignId || (state === 'sent' && payload.businessDate < oldestDay) || !('fact' in payload)) continue;
    if (payload.fact.type === 'Weighing') answered.add(payload.fact.weighingRequestId);
  }
  return campaign.weighingRequests.filter(({ weighingRequestId }) => !answered.has(weighingRequestId));
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
  /**
   * What its pencil does (K.5): `edit` while it never left the phone; `locked` while a sending is
   * in doubt; `correct` once sent — a counter-declaration, online; `null`: nothing to correct
   * (taken back, or no measured value).
   */
  readonly pencil: LinePencil;
  /** For a delivery: what was received, by name and category, when the phone knows it (Q.7). */
  readonly delivery?: { readonly name: string; readonly category: string };
};

export type LinePencil = 'edit' | 'locked' | 'correct' | null;

/** The journal of one day, the latest written on top — the server's lines with the phone's. */
export function linesOf(campaign: CaretakerCampaign, journal: readonly JournalEvent[], entries: readonly OutboxEntry[], day: BusinessDay): NotebookLine[] {
  const waiting = new Set(entries.filter((entry) => entry.state === 'pending' || entry.state === 'in-doubt').map((entry) => entry.id));
  const correctedByServer = new Set(campaign.journal.filter((line) => line.corrected).map((line) => line.id));
  const stateOf = new Map(entries.map((entry) => [entry.id, entry.state]));
  const pencilOf = (id: string, type: string, correctionWaits: boolean): LinePencil =>
    type !== 'Death' && type !== 'BagOpened' ? null : stateOf.get(id) === 'in-doubt' || correctionWaits ? 'locked' : stateOf.get(id) === 'pending' ? 'edit' : 'correct';
  // What each order line delivers: from the server's lines, or from what is still expected.
  const deliveredOf = new Map<string, { name: string; category: string }>([
    ...campaign.deliveries.flatMap((delivery) => delivery.lines.map((line) => [line.orderLineId, { name: line.name, category: line.category }] as const)),
    ...campaign.journal.flatMap((line) => (line.fact.type === 'Delivery' && line.delivery !== undefined ? [[line.fact.orderLineId, line.delivery] as const] : [])),
  ]);
  const deliveryOf = (fact: FactPayload) => (fact.type === 'Delivery' ? deliveredOf.get(fact.orderLineId) : undefined);
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
      pencil: line.retraction !== null ? null : pencilOf(line.declaration.id, line.declaration.type, line.correction !== null && waiting.has(line.correction.id)),
    }))
    .map((line) => {
      const delivery = deliveryOf(line.fact);
      return delivery === undefined ? line : { ...line, delivery };
    });
  const takenBack: NotebookLine[] = campaign.journal.filter((line) => line.retracted && line.businessDate === day).map(retractedLine);
  return [...standing, ...takenBack].sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : a.recordedAt > b.recordedAt ? -1 : 0));
}

function retractedLine(line: CaretakerJournalLine): NotebookLine {
  return { id: line.id, recordedAt: line.recordedAt, authorId: line.author.id, fact: line.fact, corrected: line.corrected, retracted: true, waiting: false, pencil: null };
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
