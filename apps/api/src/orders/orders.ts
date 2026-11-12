import { err, Money, ok, type CurrencyCode, type Result } from '@kit';
import {
  announceOrder,
  billableOf,
  closeOrder,
  COST_CATEGORIES,
  draftOrder,
  orderBalance,
  orderStatus,
  recordPayment,
  reviseOrder,
  type Payment,
  type PaymentId,
  type CostTypeId,
  type CounterpartyId,
  type DraftOrderContext,
  type OrderRefusal as DomainOrderRefusal,
  type PurchaseOrder,
  type PurchaseOrderId,
} from '@domain/finance';
import { instantOf, receivedByLine, type BusinessDay, type CampaignId, type Instant, type OrderLineId, type TenantId } from '@domain/journal';
import { Prisma } from '@prisma/client';
import type { DraftOrderRequest, OrderRefusal, OrderView, RecordPaymentRequest } from '@contracts';
import { recordAudit } from '../audit/audit';
import type { Session } from '../auth/session';
import { PrismaJournal } from '../journal/prisma-journal';

type Tx = Prisma.TransactionClient;
type OrderRow = Prisma.PurchaseOrderGetPayload<{ include: { lines: true } }>;
type PaymentRow = Prisma.PaymentGetPayload<object>;

const refusal = (error: DomainOrderRefusal): OrderRefusal => ('lineId' in error ? { kind: error.kind, lineId: error.lineId } : { kind: error.kind });

/** The orders of the farm, each with what its lines received (from the journal) and its state, deduced. */
export async function listOrders(tx: Tx, tenantId: TenantId): Promise<OrderView[]> {
  const rows = await tx.purchaseOrder.findMany({ include: { lines: { orderBy: { position: 'asc' } } }, orderBy: [{ orderDay: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }] });
  const received = await receivedByCampaign(tx, tenantId, [...new Set(rows.map((row) => row.campaignId))]);
  const payments = await tx.payment.findMany({ orderBy: [{ paidOn: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] });
  return rows.map((row) => {
    const order = orderOf(row);
    return viewOf(order, received.get(row.campaignId) ?? new Map(), payments.filter((payment) => payment.orderId === row.id).map((payment) => paymentOf(payment, order.currency)));
  });
}

/**
 * The admin records a payment of an order of the farm, whatever its state (Q.9, decision of
 * 2026-11-11). A money entry: its identifier is made at the office, so the same payment sent
 * again is a duplicate, kept once; the same identifier with another content is refused. Traced.
 */
export async function payPurchaseOrder(tx: Tx, admin: Session, orderId: string, request: RecordPaymentRequest, now: Date): Promise<Result<'Recorded' | 'Duplicate', OrderRefusal>> {
  const order = await findOrder(tx, orderId);
  if (order === null) return err({ kind: 'OrderNotFound' });
  const payment = recordPayment({ ...request, orderId: order.id }, order.currency);
  if (!payment.ok) return err(payment.error.kind === 'InvalidId' ? { kind: 'InvalidId' } : { kind: payment.error.kind });
  const paidBy = payment.value.paidBy ?? null;
  // Someone else who paid (R.4): a counterparty of the farm in use, never the supplier paying itself.
  if (paidBy !== null) {
    if (paidBy === order.supplierId) return err({ kind: 'PaidBySupplier' });
    const payer = await tx.counterparty.findUnique({ where: { id: paidBy }, select: { archivedAt: true } });
    if (payer === null) return err({ kind: 'UnknownCounterparty' });
    if (payer.archivedAt !== null) return err({ kind: 'CounterpartyArchived' });
  }
  const existing = await tx.payment.findUnique({ where: { id: payment.value.id } });
  if (existing !== null) {
    const same =
      existing.orderId === order.id &&
      existing.paidOn.toISOString().slice(0, 10) === payment.value.paidOn &&
      existing.amount === payment.value.amount.amount &&
      existing.method === payment.value.method &&
      existing.paidById === paidBy;
    return same ? ok('Duplicate') : err({ kind: 'PaymentAlreadyExists' });
  }
  try {
    await tx.payment.create({
      data: { tenantId: admin.tenantId, id: payment.value.id, orderId: order.id, paidOn: new Date(payment.value.paidOn), amount: payment.value.amount.amount, method: payment.value.method, paidById: paidBy, recordedBy: admin.userId },
    });
  } catch (error) {
    // The identifier is taken in another farm, which this transaction does not see.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return err({ kind: 'PaymentAlreadyExists' });
    throw error;
  }
  await recordAudit(tx, admin.tenantId, { action: 'PaymentRecorded', actorId: admin.userId, subjectId: payment.value.id, siteId: await siteOf(tx, order.campaignId), deviceId: admin.deviceId }, now);
  return ok('Recorded');
}

/** The admin writes a draft (Q.4): judged by the domain against the farm, for a campaign of the farm that is not closed. Traced. */
export async function draftPurchaseOrder(tx: Tx, admin: Session, request: DraftOrderRequest, now: Date): Promise<Result<void, OrderRefusal>> {
  const order = draftOrder(request, await contextOf(tx, admin.tenantId));
  if (!order.ok) return err(refusal(order.error));
  const campaign = await openCampaign(tx, order.value.campaignId);
  if (!campaign.ok) return campaign;
  try {
    await tx.purchaseOrder.create({ data: { ...headerOf(order.value), tenantId: admin.tenantId, id: order.value.id, currency: order.value.currency } });
  } catch (error) {
    // The identifier is taken — here, or in another farm, which this transaction does not see.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return err({ kind: 'OrderAlreadyExists' });
    throw error;
  }
  await writeLines(tx, admin.tenantId, order.value);
  await recordAudit(tx, admin.tenantId, { action: 'OrderDrafted', actorId: admin.userId, subjectId: order.value.id, siteId: campaign.value.siteId, deviceId: admin.deviceId }, now);
  return ok(undefined);
}

/** Only a draft changes, rewritten whole, lines included (they received nothing yet). Traced. */
export async function revisePurchaseOrder(tx: Tx, admin: Session, id: string, request: DraftOrderRequest, now: Date): Promise<Result<void, OrderRefusal>> {
  const current = await findOrder(tx, id);
  if (current === null) return err({ kind: 'OrderNotFound' });
  const order = reviseOrder(current, request, await contextOf(tx, admin.tenantId));
  if (!order.ok) return err(refusal(order.error));
  const campaign = await openCampaign(tx, order.value.campaignId);
  if (!campaign.ok) return campaign;
  await tx.orderLine.deleteMany({ where: { orderId: id } });
  await tx.purchaseOrder.update({ where: { id }, data: headerOf(order.value) });
  await writeLines(tx, admin.tenantId, order.value);
  await recordAudit(tx, admin.tenantId, { action: 'OrderRevised', actorId: admin.userId, subjectId: id, siteId: campaign.value.siteId, deviceId: admin.deviceId }, now);
  return ok(undefined);
}

/** A draft is announced once: the caretaker of its site will see the delivery coming (Q.6). Traced. */
export async function announcePurchaseOrder(tx: Tx, admin: Session, id: string, now: Date): Promise<Result<void, OrderRefusal>> {
  const current = await findOrder(tx, id);
  if (current === null) return err({ kind: 'OrderNotFound' });
  const order = announceOrder(current, instantOf(now));
  if (!order.ok) return err(refusal(order.error));
  await tx.purchaseOrder.update({ where: { id }, data: { announcedAt: now } });
  await recordAudit(tx, admin.tenantId, { action: 'OrderAnnounced', actorId: admin.userId, subjectId: id, siteId: await siteOf(tx, current.campaignId), deviceId: admin.deviceId }, now);
  return ok(undefined);
}

/** An announced order not fully received is closed: the rest will not come. Traced. */
export async function closePurchaseOrder(tx: Tx, admin: Session, id: string, now: Date): Promise<Result<void, OrderRefusal>> {
  const current = await findOrder(tx, id);
  if (current === null) return err({ kind: 'OrderNotFound' });
  const received = (await receivedByCampaign(tx, admin.tenantId, [current.campaignId])).get(current.campaignId) ?? new Map();
  const order = closeOrder(current, received, instantOf(now));
  if (!order.ok) return err(refusal(order.error));
  await tx.purchaseOrder.update({ where: { id }, data: { closedAt: now } });
  await recordAudit(tx, admin.tenantId, { action: 'OrderClosed', actorId: admin.userId, subjectId: id, siteId: await siteOf(tx, current.campaignId), deviceId: admin.deviceId }, now);
  return ok(undefined);
}

/** Every order of the farm as the domain sees it, with what it received and its payments: what the ledger reads (R.1). */
export async function ordersWithMoney(tx: Tx, tenantId: TenantId): Promise<{ order: PurchaseOrder; received: ReadonlyMap<string, number>; payments: Payment[] }[]> {
  const rows = await tx.purchaseOrder.findMany({ include: { lines: { orderBy: { position: 'asc' } } } });
  const received = await receivedByCampaign(tx, tenantId, [...new Set(rows.map((row) => row.campaignId))]);
  const payments = await tx.payment.findMany();
  return rows.map((row) => {
    const order = orderOf(row);
    return { order, received: received.get(row.campaignId) ?? new Map(), payments: payments.filter((payment) => payment.orderId === row.id).map((payment) => paymentOf(payment, order.currency)) };
  });
}

/** The billable of each order of a campaign (Q.3): what entered its committed cost by being received. */
export async function billablesOf(tx: Tx, tenantId: TenantId, campaignId: string): Promise<Money[]> {
  const rows = await tx.purchaseOrder.findMany({ where: { campaignId }, include: { lines: { orderBy: { position: 'asc' } } } });
  const received = (await receivedByCampaign(tx, tenantId, [campaignId])).get(campaignId) ?? new Map();
  return rows.map((row) => {
    const billable = billableOf(orderOf(row), received);
    if (!billable.ok) throw new Error(`Order ${row.id} has no computable billable`);
    return billable.value.total;
  });
}

// Who and what the farm has: the order is judged against it.
async function contextOf(tx: Tx, tenantId: string): Promise<DraftOrderContext> {
  const [tenant, counterparties, costTypes] = await Promise.all([
    tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { currency: true } }),
    tx.counterparty.findMany({ select: { id: true, kind: true, archivedAt: true } }),
    tx.costType.findMany({ select: { id: true, category: true, archivedAt: true } }),
  ]);
  return {
    currency: tenant.currency as CurrencyCode,
    counterparties: counterparties.map(({ id, kind, archivedAt }) => ({ id, kind, archived: archivedAt !== null })),
    costTypes: costTypes.map(({ id, category, archivedAt }) => ({ id, orderable: COST_CATEGORIES.find((entry) => entry.category === category)?.orderable ?? false, archived: archivedAt !== null })),
  };
}

async function openCampaign(tx: Tx, campaignId: string): Promise<Result<{ siteId: string }, OrderRefusal>> {
  const campaign = await tx.campaign.findUnique({ where: { id: campaignId }, select: { siteId: true, closedAt: true } });
  if (campaign === null) return err({ kind: 'UnknownCampaign' });
  if (campaign.closedAt !== null) return err({ kind: 'CampaignClosed' });
  return ok({ siteId: campaign.siteId });
}

async function siteOf(tx: Tx, campaignId: string): Promise<string> {
  return (await tx.campaign.findUniqueOrThrow({ where: { id: campaignId }, select: { siteId: true } })).siteId;
}

async function findOrder(tx: Tx, id: string): Promise<PurchaseOrder | null> {
  const row = /^[0-9a-f-]{36}$/.test(id) ? await tx.purchaseOrder.findUnique({ where: { id }, include: { lines: { orderBy: { position: 'asc' } } } }) : null;
  return row === null ? null : orderOf(row);
}

// What each line of each campaign received, read once per campaign from its journal.
async function receivedByCampaign(tx: Tx, tenantId: TenantId, campaignIds: readonly string[]): Promise<Map<string, ReadonlyMap<string, number>>> {
  const journal = new PrismaJournal(tx, tenantId);
  const received = new Map<string, ReadonlyMap<string, number>>();
  for (const campaignId of campaignIds) {
    received.set(campaignId, receivedByLine(await journal.campaignJournal(campaignId)));
  }
  return received;
}

const headerOf = (order: PurchaseOrder) => ({ supplierId: order.supplierId, campaignId: order.campaignId, orderDay: new Date(order.orderDay), reference: order.reference });

async function writeLines(tx: Tx, tenantId: string, order: PurchaseOrder): Promise<void> {
  await tx.orderLine.createMany({
    data: order.lines.map((line, position) => ({ tenantId, id: line.id, orderId: order.id, position, costTypeId: line.costTypeId, quantity: line.quantity, unitPrice: line.unitPrice.amount })),
  });
}

// A stored order read back as the domain's: written once by the domain, so its values are valid.
function orderOf(row: OrderRow): PurchaseOrder {
  const currency = row.currency as CurrencyCode;
  return Object.freeze({
    id: row.id as PurchaseOrderId,
    supplierId: row.supplierId as CounterpartyId,
    campaignId: row.campaignId as CampaignId,
    orderDay: row.orderDay.toISOString().slice(0, 10) as BusinessDay,
    currency,
    reference: row.reference,
    lines: Object.freeze(
      row.lines.map((line) => {
        const unitPrice = Money.of(line.unitPrice, currency);
        if (!unitPrice.ok) throw new Error(`Order line ${line.id} holds an invalid price`);
        return Object.freeze({ id: line.id as OrderLineId, costTypeId: line.costTypeId as CostTypeId, quantity: line.quantity as PurchaseOrder['lines'][number]['quantity'], unitPrice: unitPrice.value });
      }),
    ),
    announcedAt: row.announcedAt === null ? null : (row.announcedAt.toISOString() as Instant),
    closedAt: row.closedAt === null ? null : (row.closedAt.toISOString() as Instant),
  });
}

// A stored payment read back as the domain's: written once by the domain, so its values are valid.
function paymentOf(row: PaymentRow, currency: CurrencyCode): Payment {
  const amount = Money.of(row.amount, currency);
  if (!amount.ok) throw new Error(`Payment ${row.id} holds an invalid amount`);
  return Object.freeze({
    id: row.id as PaymentId,
    orderId: row.orderId as PurchaseOrderId,
    paidOn: row.paidOn.toISOString().slice(0, 10) as BusinessDay,
    amount: amount.value,
    method: row.method,
    ...(row.paidById === null ? {} : { paidBy: row.paidById }),
  });
}

function viewOf(order: PurchaseOrder, received: ReadonlyMap<string, number>, payments: readonly Payment[]): OrderView {
  const balance = orderBalance(order, received, payments);
  if (!balance.ok) throw new Error(`Order ${order.id} has no computable balance`);
  return {
    id: order.id,
    supplierId: order.supplierId,
    campaignId: order.campaignId,
    orderDay: order.orderDay,
    reference: order.reference,
    currency: order.currency,
    status: orderStatus(order, received, balance.value.paidInFull),
    lines: order.lines.map((line) => ({ id: line.id, costTypeId: line.costTypeId, quantity: line.quantity, unitPrice: line.unitPrice.amount, received: received.get(line.id) ?? 0 })),
    billable: balance.value.billable.amount,
    paid: balance.value.paid.amount,
    payments: payments.map(({ id, paidOn, amount, method, paidBy }) => ({ id, paidOn, amount: amount.amount, method, paidBy: paidBy ?? null })),
  };
}
