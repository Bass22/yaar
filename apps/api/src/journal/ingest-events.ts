import { unwrap } from '@kit';
import {
  authorizeDeclaration,
  isCounterDeclaration,
  isRetraction,
  UserId,
  validateAgainstDay,
  validateCounterDeclaration,
  validateDeclaration,
  validateDeliveryTarget,
  validateRetraction,
  type BusinessDay,
  type Campaign,
  type CampaignId,
  type DeliveryTarget,
  type JournalEvent,
  type JournalEventId,
  type OrderLineId,
  type Refusal,
  type SiteStaff,
  type TimeZone,
} from '@domain/journal';
import type { Session } from '../auth/session';
import { decodeJournalEvent, type DecodingRefusal } from './decode-event';

// Ingestion of a batch of the journal (Architecture §5): what a phone sent, judged by the
// rules of the domain and added to the journal of the farm of the session. Idempotent on the
// identifier: an event already received is a duplicate, never an error and never counted twice.

/** A site of the farm, as far as the field rules need to know it. */
export type SiteContext = {
  readonly staff: SiteStaff;
  readonly timeZone: TimeZone;
};

/** The journal of the farm of the session, and what judging an event reads. */
export type IngestionPorts = {
  /** Every site of the farm: a farm has few. */
  sites(): Promise<readonly SiteContext[]>;
  /** A campaign of the farm; `null` when unknown — or of another farm, which this journal does not see. */
  campaign(id: CampaignId): Promise<Campaign | null>;
  /** An event of the journal of the farm; `null` when absent. */
  event(id: JournalEventId): Promise<JournalEvent | null>;
  /** Whether the journal holds a retraction of that event. */
  isRetracted(id: JournalEventId): Promise<boolean>;
  /** The order line a delivery names, with its campaign and its order's state; `null` when the farm has none. */
  orderLine(id: OrderLineId): Promise<DeliveryTarget | null>;
  /** Every event written for that day of that campaign: declarations, corrections, retractions. */
  dayJournal(campaignId: CampaignId, day: BusinessDay): Promise<readonly JournalEvent[]>;
  /** Adds the event, with the device of the session. */
  append(event: JournalEvent, deviceId: string): Promise<void>;
  /**
   * Keeps a well-formed event refused by a rule of the trade, whole, with its reason and the
   * device of the session, so that the chef sees it and can write it again (G.5). Once per event:
   * the same event refused again is not kept twice.
   */
  recordRefusal(event: JournalEvent, refusal: Refusal | IngestionRefusal, deviceId: string): Promise<void>;
};

export type IngestionRefusal =
  | DecodingRefusal
  /** The campaign is not one of the farm. */
  | { readonly kind: 'UnknownCampaign' }
  /** A correction or a retraction names an event that is not in the journal. */
  | { readonly kind: 'UnknownEvent' };

/** The fate of each event of a batch, at its position (`index`) in the batch as sent. */
export type IngestionOutcome =
  | { readonly index: number; readonly id: string; readonly status: 'Accepted' | 'Duplicate' }
  | { readonly index: number; readonly id?: string; readonly status: 'Refused'; readonly refusal: IngestionRefusal };

/**
 * Judges a batch and adds what passes to the journal. The author, the farm and the device come
 * from the session; an event is judged at the instant it was written (`recordedAt`), never at
 * its arrival, so ingestion reads no clock — a phone whose clock runs ahead is accepted, and the
 * database keeps its reception date beside it (decision of 2026-11-07; warning the admin is
 * computed from the two dates, O.4). Within a batch, declarations go in
 * first, then corrections, then retractions, so that what names an event finds it; the
 * outcomes come back in the order sent.
 */
export async function ingestEvents(batch: readonly unknown[], session: Session, ports: IngestionPorts): Promise<IngestionOutcome[]> {
  const sites = new Map((await ports.sites()).map((site) => [site.staff.siteId as string, site]));
  const authorId = unwrap(UserId(session.userId));
  const decoded = batch.map((raw, index) => ({
    index,
    event: decodeJournalEvent(raw, { tenantId: session.tenantId, authorId }),
  }));

  const outcomes: IngestionOutcome[] = [];
  const rank = (event: JournalEvent) => (isRetraction(event) ? 2 : isCounterDeclaration(event) ? 1 : 0);
  const ordered = [...decoded].sort((a, b) => (a.event.ok ? rank(a.event.value) : -1) - (b.event.ok ? rank(b.event.value) : -1) || a.index - b.index);
  for (const { index, event } of ordered) {
    if (!event.ok) {
      outcomes.push({ index, status: 'Refused', refusal: event.error });
      continue;
    }
    outcomes.push(await ingestOne(event.value, index, session, sites, ports));
  }
  return outcomes.sort((a, b) => a.index - b.index);
}

async function ingestOne(
  event: JournalEvent,
  index: number,
  session: Session,
  sites: ReadonlyMap<string, SiteContext>,
  ports: IngestionPorts,
): Promise<IngestionOutcome> {
  const refused = (refusal: IngestionRefusal): IngestionOutcome => ({ index, id: event.id, status: 'Refused', refusal });
  if ((await ports.event(event.id)) !== null) {
    return { index, id: event.id, status: 'Duplicate' };
  }
  const campaign = await ports.campaign(event.campaignId);
  const site = campaign === null ? undefined : sites.get(campaign.siteId);
  if (campaign === null || site === undefined) {
    return refused({ kind: 'UnknownCampaign' });
  }
  const context = { campaign, timeZone: site.timeZone, author: { id: event.authorId, role: session.role } };

  // From here the event is well formed and its campaign is the farm's: a refusal is kept (G.5).
  const keptAndRefused = async (refusal: Refusal | IngestionRefusal): Promise<IngestionOutcome> => {
    await ports.recordRefusal(event, refusal, session.deviceId);
    return refused(refusal);
  };
  const judged = await judge(event, context, ports);
  if (!judged.ok) {
    return keptAndRefused(judged.error);
  }
  // The staff is that of the event's own site: a site that is not the campaign's was refused above.
  const allowed = authorizeDeclaration(event, { author: context.author, site: site.staff });
  if (!allowed.ok) {
    return keptAndRefused(allowed.error);
  }
  await ports.append(event, session.deviceId);
  return { index, id: event.id, status: 'Accepted' };
}

type Judgement = { readonly ok: true } | { readonly ok: false; readonly error: Refusal | IngestionRefusal };

async function judge(event: JournalEvent, context: Parameters<typeof validateDeclaration>[1], ports: IngestionPorts): Promise<Judgement> {
  if (isRetraction(event)) {
    const retracted = await ports.event(event.retracts);
    if (retracted === null) {
      return { ok: false, error: { kind: 'UnknownEvent' } };
    }
    return validateRetraction(event, { ...context, retracted, alreadyRetracted: await ports.isRetracted(retracted.id) });
  }
  if (isCounterDeclaration(event)) {
    const corrected = await ports.event(event.corrects);
    if (corrected === null) {
      return { ok: false, error: { kind: 'UnknownEvent' } };
    }
    return validateCounterDeclaration(event, { ...context, corrected, correctedIsRetracted: await ports.isRetracted(corrected.id) });
  }
  const declared = validateDeclaration(event, context);
  if (!declared.ok) {
    return declared;
  }
  // A delivery is received on a line of an announced order not closed, of its campaign (Q.7). A
  // correction keeps the line of what it corrects: a count is corrected even once the order is closed.
  if (event.type === 'Delivery') {
    return validateDeliveryTarget(event.campaignId, await ports.orderLine(event.orderLineId));
  }
  // Only "nothing lost" is judged against its day: no need to read the day for anything else.
  return event.type === 'NoLoss' ? validateAgainstDay(event, await ports.dayJournal(event.campaignId, event.businessDate)) : declared;
}
