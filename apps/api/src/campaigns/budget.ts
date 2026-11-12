import { err, Money, ok, SignedMoney, unwrap, type CurrencyCode, type Result } from '@kit';
import { budgetVariance, committedByCategory, COST_CATEGORIES, recordBudget, suggestedBudget, type ClosedCampaignCosts, type CostCategory } from '@domain/finance';
import type { TenantId } from '@domain/journal';
import type { Prisma } from '@prisma/client';
import type { BudgetRefusal, BudgetView, RecordBudgetRequest } from '@contracts';
import { recordAudit } from '../audit/audit';
import type { Session } from '../auth/session';
import { effectiveCampaignCosts } from '../costs/costs';
import { birdsOf } from '../journal/caretaker-context';
import { PrismaJournal } from '../journal/prisma-journal';
import { receivedStockOf } from '../orders/orders';
import { leftoversReceived, leftoverValuesOf } from './leftovers';

type Tx = Prisma.TransactionClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The budget of a campaign (S.1, S.3; CdC « Budget de campagne », decisions of 2026-11-12): for
 * every category, the latest budget written, the proposal from the closed campaigns, the committed
 * cost and the variance. `null` when the campaign is not the farm's.
 */
export async function campaignBudget(tx: Tx, tenantId: TenantId, campaignId: string): Promise<BudgetView | null> {
  const campaign = UUID.test(campaignId) ? await tx.campaign.findUnique({ where: { id: campaignId }, select: { plannedHeadcount: true, closedAt: true } }) : null;
  if (campaign === null) return null;
  const { currency: code } = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { currency: true } });
  const currency = code as CurrencyCode;
  const categories = new Map((await tx.costType.findMany({ select: { id: true, category: true } })).map(({ id, category }) => [id, category as CostCategory]));
  const committed = await committedOf(tx, tenantId, campaignId, currency, categories);

  const closed = await tx.campaign.findMany({ where: { closedAt: { not: null }, id: { not: campaignId } }, select: { id: true } });
  const history: ClosedCampaignCosts[] = [];
  for (const { id } of closed) {
    history.push(await closedCostsOf(tx, tenantId, id, currency, categories));
  }
  const suggested = suggestedBudget(history, campaign.plannedHeadcount, currency);

  // The latest written counts, category by category.
  const rows = await tx.budgetLine.findMany({ where: { campaignId }, orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }], select: { category: true, amount: true } });
  const written = new Map(rows.map(({ category, amount }) => [category as CostCategory, amount === null ? null : unwrap(Money.of(amount, currency))]));

  return {
    campaignId,
    currency,
    plannedHeadcount: campaign.plannedHeadcount,
    closed: campaign.closedAt !== null,
    lines: COST_CATEGORIES.map(({ category }) => {
      const budget = written.get(category) ?? null;
      const spent = committed.get(category) ?? Money.zero(currency);
      return { category, budget: budget?.amount ?? null, suggested: suggested.get(category)?.amount ?? null, committed: spent.amount, variance: budgetVariance(budget, spent)?.amount ?? null };
    }),
  };
}

/** The admin writes the budget of a campaign that is not closed: online, never updated, traced. */
export async function recordCampaignBudget(tx: Tx, admin: Session, campaignId: string, request: RecordBudgetRequest, now: Date): Promise<Result<void, BudgetRefusal>> {
  const campaign = UUID.test(campaignId) ? await tx.campaign.findUnique({ where: { id: campaignId }, select: { siteId: true, closedAt: true } }) : null;
  if (campaign === null) return err({ kind: 'CampaignNotFound' });
  if (campaign.closedAt !== null) return err({ kind: 'CampaignClosed' });
  const { currency } = await tx.tenant.findUniqueOrThrow({ where: { id: admin.tenantId }, select: { currency: true } });
  const lines = recordBudget(request.lines, currency as CurrencyCode);
  if (!lines.ok) return err(lines.error);
  if ((await tx.budgetLine.count({ where: { id: request.id } })) > 0) return err({ kind: 'BudgetAlreadyRecorded' });
  await tx.budgetLine.createMany({
    data: lines.value.map(({ category, amount }) => ({ tenantId: admin.tenantId, id: request.id, category, campaignId, amount: amount?.amount ?? null, recordedAt: now, recordedBy: admin.userId })),
  });
  await recordAudit(tx, admin.tenantId, { action: 'BudgetRecorded', actorId: admin.userId, subjectId: campaignId, siteId: campaign.siteId, deviceId: admin.deviceId }, now);
  return ok(undefined);
}

// The committed cost by category: costs as they count, the billable of orders, the leftovers received.
async function committedOf(tx: Tx, tenantId: TenantId, campaignId: string, currency: CurrencyCode, categories: ReadonlyMap<string, CostCategory>): Promise<Map<CostCategory, Money>> {
  const items = [
    ...(await effectiveCampaignCosts(tx, tenantId, campaignId)).map(({ costTypeId, amount }) => ({ costTypeId, amount })),
    ...(await receivedStockOf(tx, tenantId, campaignId)).map(({ costTypeId, value }) => ({ costTypeId, amount: value })),
    ...(await leftoversReceived(tx, tenantId, campaignId, currency)).map(({ costTypeId, value }) => ({ costTypeId, amount: value })),
  ];
  return committedByCategory(
    items.flatMap(({ costTypeId, amount }) => {
      const category = categories.get(costTypeId);
      return category === undefined ? [] : [{ category, amount }];
    }),
    currency,
  );
}

// A closed campaign in the history: its committed cost by category, less the leftovers it passed on.
async function closedCostsOf(tx: Tx, tenantId: TenantId, campaignId: string, currency: CurrencyCode, categories: ReadonlyMap<string, CostCategory>): Promise<ClosedCampaignCosts> {
  const committed = await committedOf(tx, tenantId, campaignId, currency, categories);
  const byCategory = new Map<CostCategory, SignedMoney>([...committed].map(([category, amount]) => [category, SignedMoney.fromMoney(amount)]));
  for (const { costTypeId, value } of await leftoverValuesOf(tx, tenantId, campaignId, currency)) {
    const category = categories.get(costTypeId);
    if (category === undefined || value === null) continue;
    const net = (byCategory.get(category) ?? SignedMoney.fromMoney(Money.zero(currency))).subtract(SignedMoney.fromMoney(value));
    if (net.ok) byCategory.set(category, net.value);
  }
  const { received } = await birdsOf(tx, campaignId, await new PrismaJournal(tx, tenantId).campaignJournal(campaignId));
  return { chicksReceived: received, byCategory };
}
