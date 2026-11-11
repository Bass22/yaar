import { unwrap } from '@kit';
import {
  BusinessDay,
  CampaignId,
  Instant,
  SiteId,
  TimeZone,
  UserId,
  factOf,
  isCounterDeclaration,
  isRetraction,
  type Campaign,
  type DeliveryTarget,
  type OrderLineId,
  type JournalEvent,
  type JournalEventId,
  type Refusal,
  type TenantId,
} from '@domain/journal';
import type { JournalEvent as JournalRow, Prisma } from '@prisma/client';
import { decodeJournalEvent } from './decode-event';
import type { IngestionPorts, IngestionRefusal, SiteContext } from './ingest-events';

/**
 * The journal of one farm in PostgreSQL, read and written in the tenant transaction of the
 * request: row-level security keeps every other farm out. A row goes back to an event through
 * the same decoder as what a phone sends — what the database holds is judged like any input,
 * and a row that no longer decodes is a fault.
 */
export class PrismaJournal implements IngestionPorts {
  constructor(
    private readonly tx: Prisma.TransactionClient,
    private readonly tenantId: TenantId,
  ) {}

  async sites(): Promise<readonly SiteContext[]> {
    const sites = await this.tx.site.findMany({ include: { assignments: { select: { userId: true, isPrimary: true } } } });
    return sites.map((site) => ({
      staff: {
        siteId: unwrap(SiteId(site.id)),
        primaryCaretaker: primaryOf(site.assignments),
        substitutes: site.assignments.filter((assignment) => !assignment.isPrimary).map((assignment) => unwrap(UserId(assignment.userId))),
        strictMode: site.strictMode,
      },
      timeZone: unwrap(TimeZone(site.timeZone)),
    }));
  }

  async campaign(id: CampaignId): Promise<Campaign | null> {
    const campaign = await this.tx.campaign.findUnique({ where: { id } });
    if (campaign === null) {
      return null;
    }
    return {
      id: unwrap(CampaignId(campaign.id)),
      siteId: unwrap(SiteId(campaign.siteId)),
      placementDay: dayOf(campaign.placementDay),
      closedAt: campaign.closedAt === null ? null : unwrap(Instant(campaign.closedAt.toISOString())),
    };
  }

  async event(id: JournalEventId): Promise<JournalEvent | null> {
    const row = await this.tx.journalEvent.findUnique({ where: { tenantId_id: { tenantId: this.tenantId, id } } });
    return row === null ? null : this.eventOf(row);
  }

  /** Every event of a campaign: declarations, corrections, retractions. */
  async campaignJournal(campaignId: string): Promise<readonly JournalEvent[]> {
    const rows = await this.tx.journalEvent.findMany({ where: { campaignId } });
    return rows.map((row) => this.eventOf(row));
  }

  async isRetracted(id: JournalEventId): Promise<boolean> {
    return (await this.tx.journalEvent.count({ where: { retracts: id } })) > 0;
  }

  async orderLine(id: OrderLineId): Promise<DeliveryTarget | null> {
    const line = await this.tx.orderLine.findUnique({ where: { id }, select: { order: { select: { campaignId: true, announcedAt: true, closedAt: true } } } });
    return line === null ? null : { campaignId: line.order.campaignId as CampaignId, announced: line.order.announcedAt !== null, closed: line.order.closedAt !== null };
  }

  async dayJournal(campaignId: CampaignId, day: BusinessDay): Promise<readonly JournalEvent[]> {
    const rows = await this.tx.journalEvent.findMany({ where: { campaignId, businessDate: new Date(day) } });
    return rows.map((row) => this.eventOf(row));
  }

  async append(event: JournalEvent, deviceId: string): Promise<void> {
    const { id, tenantId, siteId, campaignId, authorId, businessDate, recordedAt } = event;
    const envelope = { id, tenantId, siteId, campaignId, authorId, businessDate: new Date(businessDate), recordedAt: new Date(recordedAt), deviceId };
    if (isRetraction(event)) {
      await this.tx.journalEvent.create({ data: { ...envelope, retracts: event.retracts } });
      return;
    }
    // `type` goes to its column, the rest of the fact to the JSON column.
    const { type, ...fact } = factOf(event);
    await this.tx.journalEvent.create({ data: { ...envelope, corrects: isCounterDeclaration(event) ? event.corrects : null, type, fact: fact as Prisma.InputJsonObject } });
  }

  async recordRefusal(event: JournalEvent, refusal: Refusal | IngestionRefusal, deviceId: string): Promise<void> {
    const campaign = await this.tx.campaign.findUniqueOrThrow({ where: { id: event.campaignId } });
    // The same event refused again — its answer lost, the phone sent it back — is kept once.
    await this.tx.refusedEvent.createMany({
      data: {
        tenantId: this.tenantId,
        eventId: event.id,
        siteId: campaign.siteId,
        campaignId: event.campaignId,
        authorId: event.authorId,
        deviceId,
        businessDate: new Date(event.businessDate),
        recordedAt: new Date(event.recordedAt),
        event: payloadOf(event) as Prisma.InputJsonObject,
        refusal: refusal as Prisma.InputJsonObject,
      },
      skipDuplicates: true,
    });
  }

  private eventOf(row: JournalRow): JournalEvent {
    const envelope = { id: row.id, siteId: row.siteId, campaignId: row.campaignId, businessDate: dayOf(row.businessDate), recordedAt: row.recordedAt.toISOString() };
    const payload =
      row.retracts !== null
        ? { ...envelope, retracts: row.retracts }
        : { ...envelope, ...(row.corrects === null ? {} : { corrects: row.corrects }), fact: { ...(row.fact as Record<string, unknown>), type: row.type } };
    const decoded = decodeJournalEvent(payload, { tenantId: this.tenantId, authorId: unwrap(UserId(row.authorId)) });
    if (!decoded.ok) {
      throw new Error(`Journal event ${row.id} no longer decodes: ${decoded.error.kind}.`);
    }
    return decoded.value;
  }
}

// The event in the form of the contract, as a phone sends it: what the chef will write again.
function payloadOf(event: JournalEvent): Record<string, unknown> {
  const { id, siteId, campaignId, businessDate, recordedAt } = event;
  const envelope = { id, siteId, campaignId, businessDate, recordedAt };
  if (isRetraction(event)) {
    return { ...envelope, retracts: event.retracts };
  }
  return { ...envelope, ...(isCounterDeclaration(event) ? { corrects: event.corrects } : {}), fact: factOf(event) };
}

function primaryOf(assignments: readonly { userId: string; isPrimary: boolean }[]) {
  const primary = assignments.find((assignment) => assignment.isPrimary);
  return primary === undefined ? null : unwrap(UserId(primary.userId));
}

// A `date` column comes back as midnight UTC: its first ten characters are the business day.
function dayOf(date: Date): BusinessDay {
  return unwrap(BusinessDay(date.toISOString().slice(0, 10)));
}
