import { err, Money, ok, type CurrencyCode, type Result } from '@kit';
import { expectedOf, forecastSummary, recordSaleForecast, type SaleForecast } from '@domain/finance';
import type { BusinessDay, TenantId } from '@domain/journal';
import type { Prisma } from '@prisma/client';
import type { RecordSaleForecastRequest, SaleForecastRefusalCode, SaleForecastsView } from '@contracts';
import { recordAudit } from '../audit/audit';
import type { Session } from '../auth/session';
import { campaignBudget } from '../campaigns/budget';
import { campaignSales } from './sales';
import { isCanonicalUuid } from '@domain/journal';

type Tx = Prisma.TransactionClient;
type Refused = { readonly kind: SaleForecastRefusalCode | 'CampaignNotFound' };

/** The campaign the forecasts belong to, or why it takes none. */
async function campaignOf(tx: Tx, campaignId: string, writing: boolean): Promise<Result<{ placementDay: Date; closed: boolean }, Refused>> {
  const campaign = isCanonicalUuid(campaignId) ? await tx.campaign.findUnique({ where: { id: campaignId }, select: { placementDay: true, closedAt: true } }) : null;
  if (campaign === null) return err({ kind: 'CampaignNotFound' });
  if (writing && campaign.closedAt !== null) return err({ kind: 'CampaignClosed' });
  return ok({ placementDay: campaign.placementDay, closed: campaign.closedAt !== null });
}

/**
 * The planned sales of a flock (W.4), the last writing of each prevailing, withdrawn ones left out;
 * their expected revenue against the budget, and the revenue of the sales made. `null` when the
 * campaign is not the farm's.
 */
export async function saleForecasts(tx: Tx, tenantId: TenantId, campaignId: string): Promise<SaleForecastsView | null> {
  const campaign = await campaignOf(tx, campaignId, false);
  if (!campaign.ok) return null;
  const [rows, budget, sales] = await Promise.all([
    tx.saleForecast.findMany({ where: { campaignId }, orderBy: [{ writtenAt: 'asc' }, { id: 'asc' }] }),
    campaignBudget(tx, tenantId, campaignId),
    campaignSales(tx, tenantId, campaignId),
  ]);
  if (budget === null || sales === null) return null;
  const currency = budget.currency as CurrencyCode;
  // The last writing of each planned sale prevails; a withdrawal leaves it out.
  const last = new Map<string, (typeof rows)[number]>();
  for (const row of rows) last.set(row.forecastId, row);
  const forecasts: SaleForecast[] = [...last.values()]
    .filter((row) => !row.withdrawn)
    .map((row) => ({
      forecastId: row.forecastId,
      buyerId: row.buyerId ?? '',
      week: (row.week ?? new Date(0)).toISOString().slice(0, 10) as BusinessDay,
      birds: row.birds ?? 0,
      pricing: { kind: row.pricing ?? 'PerBird', price: moneyOf(row.price ?? 0, currency) },
      averageWeight: row.averageWeight,
    }))
    .sort((a, b) => (a.week < b.week ? -1 : a.week > b.week ? 1 : a.forecastId < b.forecastId ? -1 : 1));
  const planned = budget.lines.filter(({ budget: amount }) => amount !== null);
  const budgetTotal = planned.length === 0 ? null : Money.of(planned.reduce((sum, { budget: amount }) => sum + (amount ?? 0), 0), currency);
  const realized = Money.of(sales.revenue, currency);
  const summary = forecastSummary(forecasts, budgetTotal === null || !budgetTotal.ok ? null : budgetTotal.value, realized.ok ? realized.value : Money.zero(currency));
  return {
    currency,
    closed: campaign.value.closed,
    forecasts: forecasts.map((forecast) => ({ forecastId: forecast.forecastId, buyerId: forecast.buyerId, week: forecast.week, birds: forecast.birds, pricing: { kind: forecast.pricing.kind, price: forecast.pricing.price.amount }, averageWeight: forecast.averageWeight, expectedRevenue: expectedOf(forecast) })),
    expectedRevenue: summary.expectedRevenue.amount,
    budget: budgetTotal === null || !budgetTotal.ok ? null : budgetTotal.value.amount,
    expectedMargin: summary.expectedMargin?.amount ?? null,
    realized: summary.realized.amount,
  };
}

/** A writing of a planned sale (W.4): judged by the domain, added as a line — the last prevails. Traced. */
export async function recordForecast(tx: Tx, admin: Session, campaignId: string, forecastId: string, request: RecordSaleForecastRequest, now: Date): Promise<Result<void, Refused>> {
  const campaign = await campaignOf(tx, campaignId, true);
  if (!campaign.ok) return campaign;
  const [tenant, buyers] = await Promise.all([
    tx.tenant.findUniqueOrThrow({ where: { id: admin.tenantId }, select: { currency: true } }),
    tx.counterparty.findMany({ select: { id: true, kind: true, archivedAt: true } }),
  ]);
  const forecast = recordSaleForecast(
    { forecastId, buyerId: request.buyerId, week: request.week, birds: request.birds, pricing: request.pricing, averageWeight: request.averageWeight },
    { currency: tenant.currency as CurrencyCode, placementDay: campaign.value.placementDay.toISOString().slice(0, 10), buyers: buyers.map(({ id, kind, archivedAt }) => ({ id, kind, archived: archivedAt !== null })) },
  );
  if (!forecast.ok) return err({ kind: forecast.error.kind });
  if ((await tx.saleForecast.count({ where: { id: request.id } })) > 0) return ok(undefined);
  const { value } = forecast;
  await tx.saleForecast.create({
    data: { tenantId: admin.tenantId, id: request.id, forecastId, campaignId, buyerId: value.buyerId, week: new Date(value.week), birds: value.birds, pricing: value.pricing.kind, price: value.pricing.price.amount, averageWeight: value.averageWeight, withdrawn: false, writtenAt: now, writtenBy: admin.userId },
  });
  await recordAudit(tx, admin.tenantId, { action: 'SaleForecastRecorded', actorId: admin.userId, subjectId: forecastId, deviceId: admin.deviceId }, now);
  return ok(undefined);
}

/** A planned sale withdrawn (W.4): a line that says so, the earlier ones kept. Traced. */
export async function withdrawForecast(tx: Tx, admin: Session, campaignId: string, forecastId: string, id: string, now: Date): Promise<Result<void, Refused>> {
  const campaign = await campaignOf(tx, campaignId, true);
  if (!campaign.ok) return campaign;
  if (!isCanonicalUuid(forecastId)) return err({ kind: 'InvalidId' });
  if ((await tx.saleForecast.count({ where: { id } })) > 0) return ok(undefined);
  await tx.saleForecast.create({ data: { tenantId: admin.tenantId, id, forecastId, campaignId, withdrawn: true, writtenAt: now, writtenBy: admin.userId } });
  await recordAudit(tx, admin.tenantId, { action: 'SaleForecastWithdrawn', actorId: admin.userId, subjectId: forecastId, deviceId: admin.deviceId }, now);
  return ok(undefined);
}

// Written by the domain's rule, a price is always whole and never below zero.
const moneyOf = (amount: number, currency: CurrencyCode): Money => {
  const money = Money.of(amount, currency);
  return money.ok ? money.value : Money.zero(currency);
};

