import { err, Money, ok, unwrap, type CurrencyCode, type Result } from '@kit';
import { recordSale, recordSaleReceipt, salesSummary, type Sale, type SaleId, type SaleReceipt, type SaleReceiptId, type CounterpartyId } from '@domain/finance';
import { recentBusinessDays, TimeZone, type BusinessDay, type CampaignId, type TenantId } from '@domain/journal';
import { Prisma } from '@prisma/client';
import type { RecordSaleRequest, SaleReceiptRequest, SaleRefusal, SalesView } from '@contracts';
import { recordAudit } from '../audit/audit';
import type { Session } from '../auth/session';
import { campaignMoney } from '../costs/costs';

type Tx = Prisma.TransactionClient;

/**
 * The admin records a sale (W.3): judged by the domain against the farm and the site's today, for
 * a campaign of the farm that is not closed; with what was paid on the spot, if anything. A money
 * entry: the same sale sent again is kept once; its identifier with another content is refused.
 * Traced. The birds leave the live count — the caretaker sees it go down, never an amount.
 */
export async function recordFarmSale(tx: Tx, admin: Session, request: RecordSaleRequest, now: Date): Promise<Result<'Recorded' | 'Duplicate', SaleRefusal>> {
  const campaign = /^[0-9a-f-]{36}$/.test(request.campaignId) ? await tx.campaign.findUnique({ where: { id: request.campaignId }, select: { closedAt: true, site: { select: { id: true, timeZone: true } } } }) : null;
  if (campaign === null) return err({ kind: 'UnknownCampaign' });
  if (campaign.closedAt !== null) return err({ kind: 'CampaignClosed' });
  const currency = await currencyOf(tx, admin.tenantId);
  const today = recentBusinessDays(now, unwrap(TimeZone(campaign.site.timeZone))).today;
  const counterparties = await tx.counterparty.findMany({ select: { id: true, kind: true, archivedAt: true } });
  const sale = recordSale(request, { currency, today, counterparties: counterparties.map(({ id, kind, archivedAt }) => ({ id, kind, archived: archivedAt !== null })) });
  if (!sale.ok) return err(refusalOf(sale.error.kind));
  const receipt = request.receivedNow === null ? null : recordSaleReceipt({ ...request.receivedNow, saleId: request.id, paidOn: request.soldOn }, { currency, today });
  if (receipt !== null && !receipt.ok) return err(refusalOf(receipt.error.kind));
  const existing = await tx.sale.findUnique({ where: { id: sale.value.id } });
  if (existing !== null) return sameSale(existing, sale.value) ? ok('Duplicate') : err({ kind: 'SaleAlreadyExists' });
  try {
    const { pricing } = sale.value;
    await tx.sale.create({
      data: {
        tenantId: admin.tenantId,
        id: sale.value.id,
        campaignId: sale.value.campaignId,
        buyerId: sale.value.buyerId,
        soldOn: new Date(sale.value.soldOn),
        birds: sale.value.birds,
        pricingKind: pricing.kind,
        unitPrice: pricing.kind === 'PerBird' ? pricing.unitPrice.amount : pricing.pricePerKilo.amount,
        grams: pricing.kind === 'PerKilo' ? pricing.grams : null,
        amount: sale.value.amount.amount,
        recordedBy: admin.userId,
      },
    });
    if (receipt !== null && receipt.ok) await writeReceipt(tx, admin, receipt.value);
  } catch (error) {
    // The identifier is taken in another farm, which this transaction does not see.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return err({ kind: 'SaleAlreadyExists' });
    throw error;
  }
  await recordAudit(tx, admin.tenantId, { action: 'SaleRecorded', actorId: admin.userId, subjectId: sale.value.id, siteId: campaign.site.id, deviceId: admin.deviceId }, now);
  return ok('Recorded');
}

/** Money received later for a sale (W.3): kept once when sent twice; another content under its identifier is refused. Traced. */
export async function receiveForSale(tx: Tx, admin: Session, saleId: string, request: SaleReceiptRequest, now: Date): Promise<Result<'Recorded' | 'Duplicate', SaleRefusal>> {
  const sale = /^[0-9a-f-]{36}$/.test(saleId) ? await tx.sale.findUnique({ where: { id: saleId }, select: { campaign: { select: { site: { select: { id: true, timeZone: true } } } } } }) : null;
  if (sale === null) return err({ kind: 'SaleNotFound' });
  const receipt = recordSaleReceipt({ ...request, saleId }, { currency: await currencyOf(tx, admin.tenantId), today: recentBusinessDays(now, unwrap(TimeZone(sale.campaign.site.timeZone))).today });
  if (!receipt.ok) return err(refusalOf(receipt.error.kind));
  const existing = await tx.saleReceipt.findUnique({ where: { id: receipt.value.id } });
  if (existing !== null) {
    const same = existing.saleId === saleId && existing.paidOn.toISOString().slice(0, 10) === receipt.value.paidOn && existing.amount === receipt.value.amount.amount && existing.method === receipt.value.method;
    return same ? ok('Duplicate') : err({ kind: 'SaleReceiptAlreadyExists' });
  }
  try {
    await writeReceipt(tx, admin, receipt.value);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return err({ kind: 'SaleReceiptAlreadyExists' });
    throw error;
  }
  await recordAudit(tx, admin.tenantId, { action: 'SaleReceiptRecorded', actorId: admin.userId, subjectId: saleId, siteId: sale.campaign.site.id, deviceId: admin.deviceId }, now);
  return ok('Recorded');
}

/** The sales of a campaign and their money (W.3), computed here; `null` when the campaign is not the farm's. */
export async function campaignSales(tx: Tx, tenantId: TenantId, campaignId: string): Promise<SalesView | null> {
  const money = await campaignMoney(tx, tenantId, campaignId);
  if (money === null) return null;
  const currency = money.currency as CurrencyCode;
  const { sales, receipts } = await salesOf(tx, currency, { campaignId });
  const summary = salesSummary(sales, receipts, unwrap(Money.of(money.committed, currency)), currency);
  const receiptsOf = (saleId: string) => receipts.filter((receipt) => receipt.saleId === saleId).sort((a, b) => (a.paidOn < b.paidOn ? -1 : a.paidOn > b.paidOn ? 1 : 0));
  return {
    campaignId,
    currency,
    birdsSold: summary.birdsSold,
    revenue: summary.revenue.amount,
    cashedIn: summary.cashedIn.amount,
    margin: summary.margin?.amount ?? null,
    averagePrice: summary.averagePrice?.amount ?? null,
    remaining: money.liveCount,
    sales: [...sales]
      .sort((a, b) => (a.soldOn > b.soldOn ? -1 : a.soldOn < b.soldOn ? 1 : 0))
      .map((sale) => ({
        id: sale.id,
        buyerId: sale.buyerId,
        soldOn: sale.soldOn,
        birds: sale.birds,
        pricing: sale.pricing.kind === 'PerBird' ? { kind: 'PerBird' as const, unitPrice: sale.pricing.unitPrice.amount } : { kind: 'PerKilo' as const, grams: sale.pricing.grams, pricePerKilo: sale.pricing.pricePerKilo.amount },
        amount: sale.amount.amount,
        received: receiptsOf(sale.id).reduce((sum, receipt) => sum + receipt.amount.amount, 0),
        receipts: receiptsOf(sale.id).map(({ id, paidOn, amount, method }) => ({ id, paidOn, amount: amount.amount, method })),
      })),
  };
}

/** The sales and receipts of the farm — or of a campaign — as the domain sees them: the ledger and the live count read them. */
export async function salesOf(tx: Tx, currency: CurrencyCode, where: { campaignId?: string } = {}): Promise<{ sales: Sale[]; receipts: SaleReceipt[] }> {
  const rows = await tx.sale.findMany({ where, include: { receipts: true } });
  const money = (amount: number) => unwrap(Money.of(amount, currency));
  const sales = rows.map(
    (row): Sale =>
      Object.freeze({
        id: row.id as SaleId,
        campaignId: row.campaignId as CampaignId,
        buyerId: row.buyerId as CounterpartyId,
        soldOn: row.soldOn.toISOString().slice(0, 10) as BusinessDay,
        birds: row.birds,
        pricing: row.pricingKind === 'PerBird' ? { kind: 'PerBird' as const, unitPrice: money(row.unitPrice) } : { kind: 'PerKilo' as const, grams: row.grams ?? 0, pricePerKilo: money(row.unitPrice) },
        amount: money(row.amount),
      }),
  );
  const receipts = rows.flatMap((row) =>
    row.receipts.map((receipt): SaleReceipt => Object.freeze({ id: receipt.id as SaleReceiptId, saleId: receipt.saleId as SaleId, paidOn: receipt.paidOn.toISOString().slice(0, 10) as BusinessDay, amount: money(receipt.amount), method: receipt.method })),
  );
  return { sales, receipts };
}

async function writeReceipt(tx: Tx, admin: Session, receipt: SaleReceipt): Promise<void> {
  await tx.saleReceipt.create({ data: { tenantId: admin.tenantId, id: receipt.id, saleId: receipt.saleId, paidOn: new Date(receipt.paidOn), amount: receipt.amount.amount, method: receipt.method, recordedBy: admin.userId } });
}

async function currencyOf(tx: Tx, tenantId: string): Promise<CurrencyCode> {
  return (await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { currency: true } })).currency as CurrencyCode;
}

function sameSale(row: Prisma.SaleGetPayload<object>, sale: Sale): boolean {
  const { pricing } = sale;
  return (
    row.campaignId === sale.campaignId &&
    row.buyerId === sale.buyerId &&
    row.soldOn.toISOString().slice(0, 10) === sale.soldOn &&
    row.birds === sale.birds &&
    row.pricingKind === pricing.kind &&
    row.unitPrice === (pricing.kind === 'PerBird' ? pricing.unitPrice.amount : pricing.pricePerKilo.amount) &&
    row.grams === (pricing.kind === 'PerKilo' ? pricing.grams : null)
  );
}

// The domain's reasons are the contract's, minus the shape of an identifier.
const refusalOf = (kind: string): SaleRefusal => ({ kind: kind as SaleRefusal['kind'] });
