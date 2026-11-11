import { err, Money, ok, unwrap, type CurrencyCode, type Result } from '@kit';
import { costEntries, effectiveCosts, ledgerOf, orderEntries, recordSettlement, settlementEntries, type CostEntry, type CostId, type CostTypeId, type CounterpartyId, type LedgerEntry, type Settlement, type SettlementId } from '@domain/finance';
import { recentBusinessDays, TimeZone, type BusinessDay, type CampaignId, type Instant, type TenantId } from '@domain/journal';
import { Prisma } from '@prisma/client';
import type { LedgerView, RecordSettlementRequest, SettlementRefusal } from '@contracts';
import { recordAudit } from '../audit/audit';
import type { Session } from '../auth/session';
import { ordersWithMoney } from '../orders/orders';

type Tx = Prisma.TransactionClient;

/**
 * « Qui doit quoi » (R.1, R.3): every counterparty's balance summed again from its entries — the
 * farm's orders and their payments, its costs still owed, its settlements. Nothing is stored.
 */
export async function farmLedger(tx: Tx, tenantId: TenantId): Promise<LedgerView> {
  const currency = await currencyOf(tx, tenantId);
  const orders = await ordersWithMoney(tx, tenantId);
  const costs = effectiveCosts((await tx.cost.findMany()).map((row) => costOf(row, currency)));
  const settlements = (await tx.settlement.findMany()).map((row) => settlementOf(row, currency));
  const entries: LedgerEntry[] = [...orders.flatMap(({ order, received, payments }) => orderEntries(order, received, payments)), ...costEntries(costs), ...settlementEntries(settlements)];
  const ledger = ledgerOf(entries, currency).sort((a, b) => Math.abs(b.balance.amount) - Math.abs(a.balance.amount) || (a.counterpartyId < b.counterpartyId ? -1 : 1));
  return {
    currency,
    youOwe: ledger.reduce((sum, line) => sum + Math.max(0, -line.balance.amount), 0),
    owedToYou: ledger.reduce((sum, line) => sum + Math.max(0, line.balance.amount), 0),
    counterparties: ledger.map(({ counterpartyId, balance, entries: own }) => ({
      counterpartyId,
      balance: balance.amount,
      entries: own.map(({ on, amount, source }) => ({
        on,
        amount: amount.amount,
        source:
          source.kind === 'OrderReceived'
            ? { kind: source.kind, orderId: source.orderId }
            : source.kind === 'OrderPayment'
              ? { kind: source.kind, orderId: source.orderId, method: source.method }
              : source.kind === 'Cost'
                ? { kind: source.kind, costId: source.costId }
                : { kind: source.kind, method: source.method, direction: source.direction },
      })),
    })),
  };
}

/**
 * A settlement with a counterparty (R.2): judged by the domain against the farm and its today. A
 * money entry: the same settlement sent again is kept once; its identifier with another content
 * is refused. Traced.
 */
export async function recordFarmSettlement(tx: Tx, admin: Session, request: RecordSettlementRequest, now: Date): Promise<Result<'Recorded' | 'Duplicate', SettlementRefusal>> {
  const [counterparties, site] = await Promise.all([
    tx.counterparty.findMany({ select: { id: true, archivedAt: true } }),
    tx.site.findFirst({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { timeZone: true } }),
  ]);
  const settlement = recordSettlement(request, {
    currency: await currencyOf(tx, admin.tenantId),
    today: recentBusinessDays(now, unwrap(TimeZone(site?.timeZone ?? 'Africa/Dakar'))).today,
    counterparties: counterparties.map(({ id, archivedAt }) => ({ id, archived: archivedAt !== null })),
  });
  if (!settlement.ok) return err(settlement.error.kind === 'InvalidId' ? { kind: 'InvalidId' } : { kind: settlement.error.kind });
  const value = settlement.value;
  const existing = await tx.settlement.findUnique({ where: { id: value.id } });
  if (existing !== null) {
    const same = existing.counterpartyId === value.counterpartyId && existing.paidOn.toISOString().slice(0, 10) === value.paidOn && existing.amount === value.amount.amount && existing.method === value.method && existing.direction === value.direction;
    return same ? ok('Duplicate') : err({ kind: 'SettlementAlreadyExists' });
  }
  try {
    await tx.settlement.create({
      data: { tenantId: admin.tenantId, id: value.id, counterpartyId: value.counterpartyId, paidOn: new Date(value.paidOn), amount: value.amount.amount, method: value.method, direction: value.direction, recordedBy: admin.userId },
    });
  } catch (error) {
    // The identifier is taken in another farm, which this transaction does not see.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return err({ kind: 'SettlementAlreadyExists' });
    throw error;
  }
  await recordAudit(tx, admin.tenantId, { action: 'SettlementRecorded', actorId: admin.userId, subjectId: value.id, deviceId: admin.deviceId }, now);
  return ok('Recorded');
}

async function currencyOf(tx: Tx, tenantId: string): Promise<CurrencyCode> {
  return (await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { currency: true } })).currency as CurrencyCode;
}

// Stored rows read back as the domain's: written once by the domain, so their values are valid.
function costOf(row: Prisma.CostGetPayload<object>, currency: CurrencyCode): CostEntry {
  return Object.freeze({
    id: row.id as CostId,
    corrects: row.corrects as CostId | null,
    campaignId: row.campaignId as CampaignId,
    costTypeId: row.costTypeId as CostTypeId,
    spentOn: row.spentOn.toISOString().slice(0, 10) as BusinessDay,
    amount: unwrap(Money.of(row.amount, currency)),
    note: row.note,
    payment: row.paymentKind === 'Paid' ? { kind: 'Paid' as const } : { kind: 'ToPay' as const, counterpartyId: row.counterpartyId as CounterpartyId },
    receipt: row.receipt,
    recordedAt: row.recordedAt.toISOString() as Instant,
  });
}

function settlementOf(row: Prisma.SettlementGetPayload<object>, currency: CurrencyCode): Settlement {
  return Object.freeze({
    id: row.id as SettlementId,
    counterpartyId: row.counterpartyId as CounterpartyId,
    paidOn: row.paidOn.toISOString().slice(0, 10) as BusinessDay,
    amount: unwrap(Money.of(row.amount, currency)),
    method: row.method,
    direction: row.direction,
  });
}
