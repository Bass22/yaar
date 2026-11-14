import { err, ok, unwrap, type Result } from '@kit';
import { planReception, receptionProgress } from '@domain/finance';
import { recentBusinessDays, TimeZone, type TenantId } from '@domain/journal';
import type { Prisma } from '@prisma/client';
import type { PlanReceptionRefusalCode, PlanReceptionRequest, ReceptionsView } from '@contracts';
import { recordAudit } from '../audit/audit';
import type { Session } from '../auth/session';
import { activeReceptions } from './active-receptions';
import { announceOrderSilently, findOrder, ordersWithMoney } from './orders';

type Tx = Prisma.TransactionClient;
type Refused = { readonly kind: PlanReceptionRefusalCode | 'OrderNotFound' };

/**
 * The planned receptions of the orders still open (Q.14; decisions of 2026-11-13), each at its last
 * writing, with the days it was planned on before; what the caretaker received fills them in the
 * order of their days. A closed order waits for nothing: its planned receptions leave the list.
 */
export async function listReceptions(tx: Tx, tenantId: TenantId, now: Date): Promise<ReceptionsView> {
  const site = await tx.site.findFirst({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { timeZone: true } });
  const today = recentBusinessDays(now, unwrap(TimeZone(site?.timeZone ?? 'Africa/Dakar'))).today;
  const [orders, active] = await Promise.all([ordersWithMoney(tx, tenantId), activeReceptions(tx)]);
  const receptions: ReceptionsView['receptions'][number][] = [];
  for (const { order, received } of orders) {
    if (order.closedAt !== null) continue;
    const planned = active.get(order.id) ?? [];
    const before = new Map(planned.map(({ receptionId, previousDates }) => [receptionId, [...previousDates]]));
    const typeOf = new Map(order.lines.map((line) => [line.id as string, line.costTypeId as string]));
    for (const progress of receptionProgress(planned, received, today)) {
      receptions.push({
        receptionId: progress.receptionId,
        orderId: order.id,
        supplierId: order.supplierId,
        campaignId: order.campaignId,
        plannedOn: progress.plannedOn,
        previousDates: before.get(progress.receptionId) ?? [],
        state: progress.state,
        lines: progress.lines.map((line) => ({ ...line, costTypeId: typeOf.get(line.orderLineId) ?? '' })),
      });
    }
  }
  receptions.sort((a, b) => (a.plannedOn !== b.plannedOn ? (a.plannedOn < b.plannedOn ? -1 : 1) : a.receptionId < b.receptionId ? -1 : 1));
  return { today, receptions };
}

/** A writing of a planned reception (Q.14): judged by the domain, added as a line — a new day reschedules it. Traced. */
export async function planOrderReception(tx: Tx, admin: Session, orderId: string, receptionId: string, request: PlanReceptionRequest, now: Date): Promise<Result<void, Refused>> {
  const order = await findOrder(tx, orderId);
  if (order === null) return err({ kind: 'OrderNotFound' });
  const planned = planReception({ receptionId, plannedOn: request.plannedOn, lines: request.lines }, order);
  if (!planned.ok) return err({ kind: planned.error.kind });
  if ((await tx.plannedReception.count({ where: { id: request.id } })) > 0) return ok(undefined);
  // « Déclarer des réceptions » (Q.15): the first one announces a draft — the caretaker is told of
  // each reception on its day, never of the whole order.
  if (order.announcedAt === null) await announceOrderSilently(tx, admin, orderId, now);
  await tx.plannedReception.create({
    data: { tenantId: admin.tenantId, id: request.id, receptionId, orderId, plannedOn: new Date(planned.value.plannedOn), lines: planned.value.lines.map(({ orderLineId, quantity }) => ({ orderLineId, quantity })), withdrawn: false, writtenAt: now, writtenBy: admin.userId },
  });
  await recordAudit(tx, admin.tenantId, { action: 'ReceptionPlanned', actorId: admin.userId, subjectId: receptionId, deviceId: admin.deviceId }, now);
  return ok(undefined);
}

/** A planned reception withdrawn (Q.14): a line that says so, the earlier ones kept. Traced. */
export async function withdrawReception(tx: Tx, admin: Session, orderId: string, receptionId: string, id: string, now: Date): Promise<Result<void, Refused>> {
  const order = await tx.purchaseOrder.findUnique({ where: { id: orderId }, select: { id: true } });
  if (order === null) return err({ kind: 'OrderNotFound' });
  if ((await tx.plannedReception.count({ where: { id } })) > 0) return ok(undefined);
  await tx.plannedReception.create({ data: { tenantId: admin.tenantId, id, receptionId, orderId, withdrawn: true, writtenAt: now, writtenBy: admin.userId } });
  await recordAudit(tx, admin.tenantId, { action: 'ReceptionWithdrawn', actorId: admin.userId, subjectId: receptionId, deviceId: admin.deviceId }, now);
  return ok(undefined);
}
