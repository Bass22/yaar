import { unwrap } from '@kit';
import { campaignDay, effectiveJournal, factOf, lineDelivery, receivedByLine, recentBusinessDays, TimeZone, type BusinessDay, type JournalEvent, type JournalLine, type OrderLineId, type Quantity, answeredWeighingRequests } from '@domain/journal';
import type { CaretakerCampaign, CaretakerContext, CaretakerDelivery, CaretakerDeliveryLine, CaretakerJournalLine, CaretakerSite, FactPayload } from '@contracts';
import type { Prisma } from '@prisma/client';
import type { Session } from '../auth/session';
import { dueReceptionLines, receptionProgress } from '@domain/finance';
import { activeReceptions } from '../orders/active-receptions';
import { PrismaJournal } from './prisma-journal';
import { namesOf } from './author-names';
import { reachableSites } from '../auth/site-access';
import { birdsOf } from './birds';

// What the caretaker's notebook shows (Architecture §5 « Descente »), read in the tenant
// transaction of the request. Built from the journal and the field rules only: no amount, no
// price, no balance reaches the phone (CLAUDE.md §4 rule 4) — its type is its own. Of an order it
// reads the quantities only (Q.6); nothing here reads a price, a cost or a sale.

/** The sites the session reaches — the admin all of the farm's, a collaborator their own — each with its notebook. */
export async function caretakerContext(tx: Prisma.TransactionClient, session: Session, now: Date): Promise<CaretakerContext> {
  const sites = await tx.site.findMany({
    where: reachableSites(session),
    orderBy: { name: 'asc' },
    select: { id: true, name: true, timeZone: true, assignments: { where: { isPrimary: true }, select: { userId: true } } },
  });
  const journal = new PrismaJournal(tx, session.tenantId);
  const contexts: CaretakerSite[] = [];
  for (const site of sites) {
    contexts.push(await siteContext(tx, journal, site, now, session.role === 'admin'));
  }
  // The chef to reach: the earliest admin still able to sign in. Only a name and a number leave.
  const chef = await tx.user.findFirst({ where: { role: 'admin', blockedAt: null }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { name: true, phone: true } });
  return { sites: contexts, chef };
}

type SiteRow = { id: string; name: string; timeZone: string; assignments: { userId: string }[] };

async function siteContext(tx: Prisma.TransactionClient, journal: PrismaJournal, site: SiteRow, now: Date, ahead: boolean): Promise<CaretakerSite> {
  const { today, yesterday, dayBeforeYesterday } = recentBusinessDays(now, unwrap(TimeZone(site.timeZone)));
  // Every campaign running on the site: several may run at once (decision of 2026-11-07).
  const running = await tx.campaign.findMany({ where: { siteId: site.id, closedAt: null }, orderBy: [{ placementDay: 'asc' }, { id: 'asc' }] });
  const days: readonly string[] = [dayBeforeYesterday, yesterday, today];
  const campaigns: CaretakerCampaign[] = [];
  for (const campaign of running) {
    const context = await campaignContext(tx, journal, campaign, days, today);
    // A campaign opened ahead (O.5) reaches the notebook on its day 0, in the site's time zone —
    // before, only when a delivery is announced for it: litter and feed come before the chicks
    // (Q.11). The office sees it from its opening, to prepare it.
    if (ahead || context.campaignDay >= 0 || context.deliveries.length > 0) campaigns.push(context);
  }
  return { siteId: site.id, name: site.name, timeZone: site.timeZone, today, primaryCaretakerId: site.assignments[0]?.userId ?? null, campaigns };
}

async function campaignContext(
  tx: Prisma.TransactionClient,
  journal: PrismaJournal,
  campaign: { id: string; placementDay: Date; strain: string },
  days: readonly string[],
  today: BusinessDay,
): Promise<CaretakerCampaign> {
  const placementDay = campaign.placementDay.toISOString().slice(0, 10) as BusinessDay;
  const events = await journal.campaignJournal(campaign.id);
  // Only the caretaker's three days, and only what the caretaker sees: losses that are not deaths stay with the admin.
  const lines = effectiveJournal(events).filter(
    (line) => days.includes(line.declaration.businessDate) && line.declaration.type !== 'Loss' && line.declaration.type !== 'WeighingValidated',
  );
  const nameOf = await namesOf(tx, lines.map((line) => line.declaration.authorId));
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
    deliveries: await deliveriesOf(tx, campaign.id, events, today),
    weighingRequests: await weighingRequestsOf(tx, campaign.id, events, today),
    strain: campaign.strain,
  };
}

/**
 * The weighings the chef asked for (T.2): from their day on, until a weighing of the journal —
 * not taken back — answers them. Earliest first.
 */
async function weighingRequestsOf(tx: Prisma.TransactionClient, campaignId: string, events: readonly JournalEvent[], today: BusinessDay): Promise<CaretakerCampaign['weighingRequests']> {
  const answered = answeredWeighingRequests(events);
  const requests = await tx.weighingRequest.findMany({ where: { campaignId, requestedFor: { lte: new Date(today) } }, orderBy: [{ requestedFor: 'asc' }, { id: 'asc' }] });
  return requests.filter(({ id }) => !answered.has(id)).map(({ id, requestedFor }) => ({ weighingRequestId: id, requestedFor: requestedFor.toISOString().slice(0, 10) }));
}

/**
 * The birds alive (Q.7): the chicks received on the campaign's chick lines, bonus included, less
 * deaths and losses. Unknown — never zero — until a chick line has received something.
 */
async function liveCountOf(tx: Prisma.TransactionClient, campaignId: string, events: readonly JournalEvent[]): Promise<number | null> {
  return (await birdsOf(tx, campaignId, events)).liveCount;
}

/**
 * The deliveries the caretaker waits for (Q.6): every announced order of the campaign that is
 * neither closed nor fully received, line by line — what comes, how many, what came. Quantities
 * only: the price, the supplier and the reference stay at the office (rule 4).
 */
async function deliveriesOf(tx: Prisma.TransactionClient, campaignId: string, events: readonly JournalEvent[], today: BusinessDay): Promise<CaretakerDelivery[]> {
  const orders = await tx.purchaseOrder.findMany({
    where: { campaignId, announcedAt: { not: null }, closedAt: null },
    orderBy: [{ announcedAt: 'asc' }, { id: 'asc' }],
    select: { id: true, lines: { orderBy: { position: 'asc' }, select: { id: true, quantity: true, costType: { select: { name: true, category: true, feedStage: true } } } } },
  });
  const received = receivedByLine(events);
  const planned = await activeReceptions(tx, orders.map(({ id }) => id));
  // A line as the notebook shows it: what comes, by name, and its counts — never a price (rule 4).
  type Line = (typeof orders)[number]['lines'][number];
  const lineOf = (line: Line, counts: { expected: number; received: number; remaining: number }): CaretakerDeliveryLine => ({
    orderLineId: line.id,
    name: line.costType.name,
    category: line.costType.category,
    feedStage: line.costType.feedStage,
    ...counts,
  });
  return orders
    .map((order) => {
      const receptions = planned.get(order.id) ?? [];
      // Received in several times (Q.15): only the receptions due — today or late —, never the order whole.
      if (receptions.length > 0) {
        const due = new Map(dueReceptionLines(receptionProgress(receptions, received, today)).map((line) => [line.orderLineId, line]));
        return {
          orderId: order.id,
          lines: order.lines.flatMap((line) => {
            const owed = due.get(line.id);
            return owed === undefined ? [] : [lineOf(line, { expected: owed.expected, received: owed.received, remaining: owed.remaining })];
          }),
        };
      }
      // Received in one go: the order whole, as announced.
      return {
        orderId: order.id,
        lines: order.lines.map((line) => {
          const state = lineDelivery(line.quantity as Quantity, received.get(line.id as OrderLineId) ?? 0);
          return lineOf(line, { expected: state.ordered, received: state.received, remaining: state.remaining });
        }),
      };
    })
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
