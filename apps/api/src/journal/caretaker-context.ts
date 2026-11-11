import { unwrap } from '@kit';
import { CampaignId, campaignDay, computeLiveCount, effectiveJournal, factOf, lineDelivery, receivedByLine, recentBusinessDays, TimeZone, type BusinessDay, type JournalEvent, type JournalLine, type OrderLineId, type Quantity } from '@domain/journal';
import type { CaretakerCampaign, CaretakerContext, CaretakerDelivery, CaretakerDeliveryLine, CaretakerJournalLine, CaretakerSite, FactPayload } from '@contracts';
import type { Prisma } from '@prisma/client';
import type { Session } from '../auth/session';
import { PrismaJournal } from './prisma-journal';

// What the caretaker's notebook shows (Architecture §5 « Descente »), read in the tenant
// transaction of the request. Built from the journal and the field rules only: no amount, no
// price, no balance reaches the phone (CLAUDE.md §4 rule 4) — its type is its own. Of an order it
// reads the quantities only (Q.6); nothing here reads a price, a cost or a sale.

/** The sites the session reaches — the admin all of the farm's, a collaborator their own — each with its notebook. */
export async function caretakerContext(tx: Prisma.TransactionClient, session: Session, now: Date): Promise<CaretakerContext> {
  const sites = await tx.site.findMany({
    where: session.role === 'admin' ? {} : { assignments: { some: { userId: session.userId } } },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, timeZone: true, assignments: { where: { isPrimary: true }, select: { userId: true } } },
  });
  const journal = new PrismaJournal(tx, session.tenantId);
  const contexts: CaretakerSite[] = [];
  for (const site of sites) {
    contexts.push(await siteContext(tx, journal, site, now));
  }
  // The chef to reach: the earliest admin still able to sign in. Only a name and a number leave.
  const chef = await tx.user.findFirst({ where: { role: 'admin', blockedAt: null }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { name: true, phone: true } });
  return { sites: contexts, chef };
}

type SiteRow = { id: string; name: string; timeZone: string; assignments: { userId: string }[] };

async function siteContext(tx: Prisma.TransactionClient, journal: PrismaJournal, site: SiteRow, now: Date): Promise<CaretakerSite> {
  const { today, yesterday, dayBeforeYesterday } = recentBusinessDays(now, unwrap(TimeZone(site.timeZone)));
  // Every campaign running on the site: several may run at once (decision of 2026-11-07).
  const running = await tx.campaign.findMany({ where: { siteId: site.id, closedAt: null }, orderBy: [{ placementDay: 'asc' }, { id: 'asc' }] });
  const days: readonly string[] = [dayBeforeYesterday, yesterday, today];
  const campaigns: CaretakerCampaign[] = [];
  for (const campaign of running) {
    campaigns.push(await campaignContext(tx, journal, campaign, days, today));
  }
  return { siteId: site.id, name: site.name, timeZone: site.timeZone, today, primaryCaretakerId: site.assignments[0]?.userId ?? null, campaigns };
}

async function campaignContext(
  tx: Prisma.TransactionClient,
  journal: PrismaJournal,
  campaign: { id: string; placementDay: Date },
  days: readonly string[],
  today: BusinessDay,
): Promise<CaretakerCampaign> {
  const placementDay = campaign.placementDay.toISOString().slice(0, 10) as BusinessDay;
  const events = await journal.campaignJournal(campaign.id);
  // Only the caretaker's three days, and only what the caretaker sees: losses that are not deaths stay with the admin.
  const lines = effectiveJournal(events).filter(
    (line) => days.includes(line.declaration.businessDate) && line.declaration.type !== 'Loss',
  );
  const authors = await tx.user.findMany({ where: { id: { in: [...new Set(lines.map((line) => line.declaration.authorId))] } }, select: { id: true, name: true } });
  const nameOf = new Map(authors.map((author) => [author.id, author.name]));
  // What each delivery line received is, by name and category: quantities and words only (rule 4).
  const deliveredLineIds = [...new Set(lines.flatMap((line) => (line.fact?.type === 'Delivery' ? [line.fact.orderLineId] : [])))];
  const delivered = await tx.orderLine.findMany({ where: { id: { in: deliveredLineIds } }, select: { id: true, costType: { select: { name: true, category: true } } } });
  const deliveredOf = new Map(delivered.map((line) => [line.id, line.costType]));
  return {
    campaignId: campaign.id,
    placementDay,
    campaignDay: campaignDay(placementDay, today),
    liveCount: await liveCountOf(tx, campaign.id, events),
    journal: lines.map((line) => lineOf(line, nameOf.get(line.declaration.authorId) ?? '', deliveredOf)),
    deliveries: await deliveriesOf(tx, campaign.id, events),
  };
}

/**
 * The birds alive (Q.7): the chicks received on the campaign's chick lines, bonus included, less
 * deaths and losses. Unknown — never zero — until a chick line has received something.
 */
async function liveCountOf(tx: Prisma.TransactionClient, campaignId: string, events: readonly JournalEvent[]): Promise<number | null> {
  return (await birdsOf(tx, campaignId, events)).liveCount;
}

/** The chicks received on the campaign's chick lines, and the birds alive — `null` until a chick is received (Q.7). */
export async function birdsOf(tx: Prisma.TransactionClient, campaignId: string, events: readonly JournalEvent[]): Promise<{ received: number; liveCount: number | null }> {
  const chickLines = await tx.orderLine.findMany({ where: { order: { campaignId }, costType: { category: 'Chicks' } }, select: { id: true } });
  const count = computeLiveCount(events, { campaignId: unwrap(CampaignId(campaignId)), placementOrderLines: chickLines.map(({ id }) => id as OrderLineId) });
  return { received: count.received, liveCount: count.received > 0 ? count.liveCount : null };
}

/**
 * The deliveries the caretaker waits for (Q.6): every announced order of the campaign that is
 * neither closed nor fully received, line by line — what comes, how many, what came. Quantities
 * only: the price, the supplier and the reference stay at the office (rule 4).
 */
async function deliveriesOf(tx: Prisma.TransactionClient, campaignId: string, events: readonly JournalEvent[]): Promise<CaretakerDelivery[]> {
  const orders = await tx.purchaseOrder.findMany({
    where: { campaignId, announcedAt: { not: null }, closedAt: null },
    orderBy: [{ announcedAt: 'asc' }, { id: 'asc' }],
    select: { id: true, lines: { orderBy: { position: 'asc' }, select: { id: true, quantity: true, costType: { select: { name: true, category: true } } } } },
  });
  const received = receivedByLine(events);
  return orders
    .map((order) => ({
      orderId: order.id,
      lines: order.lines.map((line) => {
        const state = lineDelivery(line.quantity as Quantity, received.get(line.id as OrderLineId) ?? 0);
        return { orderLineId: line.id, name: line.costType.name, category: line.costType.category, expected: state.ordered, received: state.received, remaining: state.remaining };
      }),
    }))
    .filter((delivery) => delivery.lines.some((line) => line.remaining > 0));
}

function lineOf(line: JournalLine, authorName: string, deliveredOf: ReadonlyMap<string, { name: string; category: CaretakerDeliveryLine['category'] }>): CaretakerJournalLine {
  const { declaration } = line;
  const fact = line.fact ?? factOf(declaration);
  const delivery = fact.type === 'Delivery' ? deliveredOf.get(fact.orderLineId) : undefined;
  return {
    ...(delivery === undefined ? {} : { delivery: { name: delivery.name, category: delivery.category } }),
    id: declaration.id,
    businessDate: declaration.businessDate,
    recordedAt: declaration.recordedAt,
    author: { id: declaration.authorId, name: authorName },
    // The fact that counts; a retracted line shows what had been declared.
    fact: (line.fact ?? factOf(declaration)) as FactPayload,
    corrected: line.correction !== null,
    retracted: line.retraction !== null,
  };
}
