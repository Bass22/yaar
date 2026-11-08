import { unwrap } from '@kit';
import { campaignDay, effectiveJournal, factOf, recentBusinessDays, TimeZone, type BusinessDay, type JournalLine } from '@domain/journal';
import type { CaretakerCampaign, CaretakerContext, CaretakerJournalLine, CaretakerSite, FactPayload } from '@contracts';
import type { Prisma } from '@prisma/client';
import type { Session } from '../auth/session';
import { PrismaJournal } from './prisma-journal';

// What the caretaker's notebook shows (Architecture §5 « Descente »), read in the tenant
// transaction of the request. Built from the journal and the field rules only: no amount, no
// price, no balance reaches the phone (CLAUDE.md §4 rule 4) — its type is its own, and nothing
// here reads an order, a cost or a sale.

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
  // Only the caretaker's three days, and only what the caretaker sees: losses that are not deaths stay with the admin.
  const lines = effectiveJournal(await journal.campaignJournal(campaign.id)).filter(
    (line) => days.includes(line.declaration.businessDate) && line.declaration.type !== 'Loss',
  );
  const authors = await tx.user.findMany({ where: { id: { in: [...new Set(lines.map((line) => line.declaration.authorId))] } }, select: { id: true, name: true } });
  const nameOf = new Map(authors.map((author) => [author.id, author.name]));
  return {
    campaignId: campaign.id,
    placementDay,
    campaignDay: campaignDay(placementDay, today),
    // Unknown, not zero: the order lines that deliver the chicks do not exist yet (orders come later).
    liveCount: null,
    journal: lines.map((line) => lineOf(line, nameOf.get(line.declaration.authorId) ?? '')),
  };
}

function lineOf(line: JournalLine, authorName: string): CaretakerJournalLine {
  const { declaration } = line;
  return {
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
