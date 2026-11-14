import type { CurrencyCode } from '@kit';
import type { Prisma } from '@prisma/client';

/** The farm's currency, never written in the code (rule 7): read in the tenant transaction. */
export async function currencyOf(tx: Prisma.TransactionClient, tenantId: string): Promise<CurrencyCode> {
  return (await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { currency: true } })).currency as CurrencyCode;
}
