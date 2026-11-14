import { err, ok, type Result } from '@kit';
import type { Prisma } from '@prisma/client';
import type { CatalogPriceRefusal, PriceCatalogView, SetCatalogPriceRequest } from '@contracts';
import { recordAudit } from '../audit/audit';
import type { Session } from '../auth/session';
import { isCanonicalUuid } from '@domain/journal';
import { currencyOf } from '../tenants/currency';

type Tx = Prisma.TransactionClient;

/**
 * The prices the farm knows (N.5; CdC « Valeurs par défaut », decisions of 2026-11-13): every
 * price paid on an order — learned, nothing invented —, and every price the admin set by hand.
 * The office proposes from them (`suggestedPrice`); it never imposes.
 */
export async function priceCatalog(tx: Tx, tenantId: string): Promise<PriceCatalogView> {
  const currency = await currencyOf(tx, tenantId);
  const [lines, set] = await Promise.all([
    tx.orderLine.findMany({ select: { costTypeId: true, unitPrice: true, order: { select: { supplierId: true, createdAt: true } } } }),
    tx.catalogPrice.findMany({ select: { costTypeId: true, supplierId: true, unitPrice: true, setAt: true } }),
  ]);
  const prices = [
    ...lines.map(({ costTypeId, unitPrice, order }) => ({ costTypeId, supplierId: order.supplierId as string | null, unitPrice, at: order.createdAt.toISOString() })),
    ...set.map(({ costTypeId, supplierId, unitPrice, setAt }) => ({ costTypeId, supplierId, unitPrice, at: setAt.toISOString() })),
  ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return { currency, prices };
}

/** The admin sets a price by hand, for one supplier or for all: added, never changed; traced. */
export async function setCatalogPrice(tx: Tx, admin: Session, request: SetCatalogPriceRequest, now: Date): Promise<Result<void, CatalogPriceRefusal>> {
  if (!Number.isSafeInteger(request.unitPrice) || request.unitPrice < 0) return err({ kind: 'InvalidPrice' });
  const type = isCanonicalUuid(request.costTypeId) ? await tx.costType.findUnique({ where: { id: request.costTypeId }, select: { id: true } }) : null;
  if (type === null) return err({ kind: 'UnknownCostType' });
  if (request.supplierId !== null) {
    const supplier = isCanonicalUuid(request.supplierId) ? await tx.counterparty.findUnique({ where: { id: request.supplierId }, select: { kind: true } }) : null;
    if (supplier?.kind !== 'Supplier') return err({ kind: 'UnknownSupplier' });
  }
  if ((await tx.catalogPrice.count({ where: { id: request.id } })) > 0) return err({ kind: 'CatalogPriceAlreadySet' });
  await tx.catalogPrice.create({ data: { tenantId: admin.tenantId, id: request.id, costTypeId: request.costTypeId, supplierId: request.supplierId, unitPrice: request.unitPrice, setAt: now, setBy: admin.userId } });
  await recordAudit(tx, admin.tenantId, { action: 'CatalogPriceSet', actorId: admin.userId, subjectId: request.id, deviceId: admin.deviceId }, now);
  return ok(undefined);
}
