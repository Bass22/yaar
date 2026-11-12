import { err, Money, ok, unwrap, type CurrencyCode, type Result } from '@kit';
import { committedCost, costPerBird, effectiveCosts, recordCost, reviseCost, type CostContext, type CostEntry, type CostId, type CostInput, type CostTypeId, type CounterpartyId } from '@domain/finance';
import { recentBusinessDays, TimeZone, type BusinessDay, type CampaignId, type Instant, type TenantId } from '@domain/journal';
import { Prisma } from '@prisma/client';
import type { CampaignMoneyView, CostRefusal, CostView, RecordCostRequest } from '@contracts';
import { recordAudit } from '../audit/audit';
import type { Session } from '../auth/session';
import { birdsOf } from '../journal/caretaker-context';
import { PrismaJournal } from '../journal/prisma-journal';
import { leftoversReceived } from '../campaigns/leftovers';
import { billablesOf } from '../orders/orders';

type Tx = Prisma.TransactionClient;
type CostRow = Prisma.CostGetPayload<object>;

/**
 * The admin writes a cost (P.1, P.3), online for now (P.7 brings the queue): judged by the domain
 * against the farm and the site's today, for a campaign of the farm that is not closed. A money
 * entry: the same cost sent again is a duplicate, kept once; its identifier with another content
 * is refused. Traced.
 */
export async function recordCampaignCost(tx: Tx, admin: Session, request: RecordCostRequest, now: Date): Promise<Result<'Recorded' | 'Duplicate', CostRefusal>> {
  const campaign = await openCampaign(tx, request.campaignId);
  if (!campaign.ok) return campaign;
  const entry = recordCost(inputOf(request, now), await contextOf(tx, admin.tenantId, campaign.value.timeZone, now));
  if (!entry.ok) return err({ kind: entry.error.kind });
  const existing = await tx.cost.findUnique({ where: { id: entry.value.id } });
  if (existing !== null) return sameCost(existing, entry.value) ? ok('Duplicate') : err({ kind: 'CostAlreadyExists' });
  const written = await write(tx, admin, entry.value);
  if (!written.ok) return written;
  await recordAudit(tx, admin.tenantId, { action: 'CostRecorded', actorId: admin.userId, subjectId: entry.value.id, siteId: campaign.value.siteId, deviceId: admin.deviceId }, now);
  return ok('Recorded');
}

/**
 * A counter-entry (P.2): the cost written again whole under a new identifier, naming the cost as
 * first written. The original stays readable; the latest written counts. Traced on the cost.
 */
export async function reviseCampaignCost(tx: Tx, admin: Session, costId: string, request: RecordCostRequest, now: Date): Promise<Result<'Recorded' | 'Duplicate', CostRefusal>> {
  const row = /^[0-9a-f-]{36}$/.test(costId) ? await tx.cost.findUnique({ where: { id: costId } }) : null;
  if (row === null) return err({ kind: 'CostNotFound' });
  const original = entryOf(row, await currencyOf(tx, admin.tenantId));
  const campaign = await tx.campaign.findUniqueOrThrow({ where: { id: original.campaignId }, select: { site: { select: { id: true, timeZone: true } } } });
  const entry = reviseCost(original, inputOf(request, now), await contextOf(tx, admin.tenantId, campaign.site.timeZone, now));
  if (!entry.ok) return err({ kind: entry.error.kind });
  const existing = await tx.cost.findUnique({ where: { id: entry.value.id } });
  if (existing !== null) return sameCost(existing, entry.value) ? ok('Duplicate') : err({ kind: 'CostAlreadyExists' });
  const written = await write(tx, admin, entry.value);
  if (!written.ok) return written;
  await recordAudit(tx, admin.tenantId, { action: 'CostRevised', actorId: admin.userId, subjectId: original.id, siteId: campaign.site.id, deviceId: admin.deviceId }, now);
  return ok('Recorded');
}

/**
 * The money of a campaign (P.3), computed here from its costs, its orders and its journal:
 * the committed cost, the birds alive, the cost per bird, and each cost as it counts with its
 * history. `null` when the campaign is not the farm's.
 */
export async function campaignMoney(tx: Tx, tenantId: TenantId, campaignId: string): Promise<CampaignMoneyView | null> {
  const campaign = /^[0-9a-f-]{36}$/.test(campaignId) ? await tx.campaign.findUnique({ where: { id: campaignId }, select: { id: true } }) : null;
  if (campaign === null) return null;
  const currency = await currencyOf(tx, tenantId);
  const rows = await tx.cost.findMany({ where: { campaignId } });
  const recordedBy = new Map(rows.map((row) => [row.id, row.recordedBy]));
  const costs = effectiveCosts(rows.map((row) => entryOf(row, currency)));
  // Leftovers received from a campaign closed into this one count as its cost (X.2).
  const received = (await leftoversReceived(tx, tenantId, campaignId, currency)).map(({ value }) => value);
  const committed = committedCost(costs, [...(await billablesOf(tx, tenantId, campaignId)), ...received], currency);
  const birds = await birdsOf(tx, campaignId, await new PrismaJournal(tx, tenantId).campaignJournal(campaignId));
  return {
    campaignId,
    currency,
    committed: committed.amount,
    liveCount: birds.liveCount,
    costPerBird: costPerBird(committed, birds)?.amount ?? null,
    costs: costs.map(({ id, current, history }): CostView => ({
      id,
      costTypeId: current.costTypeId,
      spentOn: current.spentOn,
      amount: current.amount.amount,
      note: current.note,
      payment: current.payment,
      receipt: current.receipt,
      history: history.map((entry) => ({ id: entry.id, recordedAt: entry.recordedAt, recordedBy: recordedBy.get(entry.id) ?? '', spentOn: entry.spentOn, amount: entry.amount.amount, payment: entry.payment })),
    })),
  };
}

/** The costs of a campaign as they count (their latest value), type by type: for the budget by category (S.1). */
export async function effectiveCampaignCosts(tx: Tx, tenantId: TenantId, campaignId: string): Promise<{ costTypeId: string; amount: Money }[]> {
  const currency = await currencyOf(tx, tenantId);
  const rows = await tx.cost.findMany({ where: { campaignId } });
  return effectiveCosts(rows.map((row) => entryOf(row, currency))).map(({ current }) => ({ costTypeId: current.costTypeId, amount: current.amount }));
}

// The instant of writing is the device's when it says it (P.7, rule 2), the server's otherwise.
const inputOf = (request: RecordCostRequest, now: Date): CostInput => ({ ...request, recordedAt: request.recordedAt ?? now.toISOString() });

async function openCampaign(tx: Tx, campaignId: string): Promise<Result<{ siteId: string; timeZone: string }, CostRefusal>> {
  const campaign = /^[0-9a-f-]{36}$/.test(campaignId) ? await tx.campaign.findUnique({ where: { id: campaignId }, select: { closedAt: true, site: { select: { id: true, timeZone: true } } } }) : null;
  if (campaign === null) return err({ kind: 'UnknownCampaign' });
  if (campaign.closedAt !== null) return err({ kind: 'CampaignClosed' });
  return ok({ siteId: campaign.site.id, timeZone: campaign.site.timeZone });
}

// What a cost is judged against: the farm's currency, its types and counterparties, and the day it is on the site.
async function contextOf(tx: Tx, tenantId: string, timeZone: string, now: Date): Promise<CostContext> {
  const [costTypes, counterparties] = await Promise.all([
    tx.costType.findMany({ select: { id: true, archivedAt: true } }),
    tx.counterparty.findMany({ select: { id: true, kind: true, archivedAt: true } }),
  ]);
  return {
    currency: await currencyOf(tx, tenantId),
    today: recentBusinessDays(now, unwrap(TimeZone(timeZone))).today,
    costTypes: costTypes.map(({ id, archivedAt }) => ({ id, archived: archivedAt !== null })),
    counterparties: counterparties.map(({ id, kind, archivedAt }) => ({ id, kind, archived: archivedAt !== null })),
  };
}

async function currencyOf(tx: Tx, tenantId: string): Promise<CurrencyCode> {
  return (await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { currency: true } })).currency as CurrencyCode;
}

async function write(tx: Tx, admin: Session, entry: CostEntry): Promise<Result<void, CostRefusal>> {
  try {
    await tx.cost.create({
      data: {
        tenantId: admin.tenantId,
        id: entry.id,
        corrects: entry.corrects,
        campaignId: entry.campaignId,
        costTypeId: entry.costTypeId,
        spentOn: new Date(entry.spentOn),
        amount: entry.amount.amount,
        note: entry.note,
        paymentKind: entry.payment.kind,
        counterpartyId: entry.payment.kind === 'Paid' ? null : entry.payment.counterpartyId,
        receipt: entry.receipt,
        recordedAt: new Date(entry.recordedAt),
        recordedBy: admin.userId,
      },
    });
    return ok(undefined);
  } catch (error) {
    // The identifier is taken in another farm, which this transaction does not see.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return err({ kind: 'CostAlreadyExists' });
    throw error;
  }
}

/** The same cost sent again: everything the office chose is the same; only the instant of writing differs. */
function sameCost(row: CostRow, entry: CostEntry): boolean {
  return (
    row.corrects === entry.corrects &&
    row.campaignId === entry.campaignId &&
    row.costTypeId === entry.costTypeId &&
    row.spentOn.toISOString().slice(0, 10) === entry.spentOn &&
    row.amount === entry.amount.amount &&
    row.note === entry.note &&
    row.paymentKind === entry.payment.kind &&
    row.counterpartyId === (entry.payment.kind === 'Paid' ? null : entry.payment.counterpartyId) &&
    row.receipt === entry.receipt
  );
}

// A stored cost read back as the domain's: written once by the domain, so its values are valid.
export function entryOf(row: CostRow, currency: CurrencyCode): CostEntry {
  const amount = unwrap(Money.of(row.amount, currency));
  return Object.freeze({
    id: row.id as CostId,
    corrects: row.corrects as CostId | null,
    campaignId: row.campaignId as CampaignId,
    costTypeId: row.costTypeId as CostTypeId,
    spentOn: row.spentOn.toISOString().slice(0, 10) as BusinessDay,
    amount,
    note: row.note,
    payment: row.paymentKind === 'Paid' ? { kind: 'Paid' as const } : { kind: row.paymentKind, counterpartyId: row.counterpartyId as CounterpartyId },
    receipt: row.receipt,
    recordedAt: row.recordedAt.toISOString() as Instant,
  });
}
