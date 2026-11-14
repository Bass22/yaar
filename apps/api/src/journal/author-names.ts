import type { Prisma } from '@prisma/client';

/** The names of the people who wrote, by their id — read once, in the tenant transaction. */
export async function namesOf(tx: Prisma.TransactionClient, ids: Iterable<string>): Promise<Map<string, string>> {
  const users = await tx.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } });
  return new Map(users.map(({ id, name }) => [id, name]));
}
