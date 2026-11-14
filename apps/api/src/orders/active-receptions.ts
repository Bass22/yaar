import type { PlannedReception } from '@domain/finance';
import type { BusinessDay } from '@domain/journal';
import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

export type ActiveReception = PlannedReception & {
  /** The days it was planned on before its last writing, the current one excluded (Q.14). */
  readonly previousDates: readonly string[];
};

const linesOf = (value: Prisma.JsonValue | null): PlannedReception['lines'] =>
  Array.isArray(value) ? value.map((line) => line as { orderLineId: string; quantity: number }) : [];

/**
 * The planned receptions still standing, order by order (Q.14, Q.15): each at its last writing; a
 * withdrawn one is gone. Read by the office, the caretaker's notebook and the alerts alike.
 */
export async function activeReceptions(tx: Tx, orderIds?: readonly string[]): Promise<Map<string, ActiveReception[]>> {
  const rows = await tx.plannedReception.findMany({ ...(orderIds === undefined ? {} : { where: { orderId: { in: [...orderIds] } } }), orderBy: [{ writtenAt: 'asc' }, { id: 'asc' }] });
  const writings = new Map<string, typeof rows>();
  for (const row of rows) writings.set(row.receptionId, [...(writings.get(row.receptionId) ?? []), row]);
  const byOrder = new Map<string, ActiveReception[]>();
  for (const [receptionId, own] of writings) {
    const last = own.at(-1);
    // A withdrawal carries no day (CHECK of the migration): it leaves the list.
    if (last === undefined || last.plannedOn === null) continue;
    const day = last.plannedOn.toISOString().slice(0, 10);
    const previousDates = [...new Set(own.slice(0, -1).flatMap((row) => (row.plannedOn === null ? [] : [row.plannedOn.toISOString().slice(0, 10)])))].filter((date) => date !== day);
    byOrder.set(last.orderId, [...(byOrder.get(last.orderId) ?? []), { receptionId, orderId: last.orderId, plannedOn: day as BusinessDay, lines: linesOf(last.lines), previousDates }]);
  }
  return byOrder;
}
