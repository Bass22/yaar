import { effectiveJournal, type TenantId } from '@domain/journal';
import type { Prisma } from '@prisma/client';
import type { DeathPhotosView } from '@contracts';
import { PrismaJournal } from './prisma-journal';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * How each caretaker answered for the dead (K.6): of its death declarations not taken back, how
 * many were photographed, said « no photo », or carry no answer (written before K.6, or by an
 * admin). The declaration as written: a correction changes the count, not the answer. By name.
 * `null` when the campaign is not the farm's.
 */
export async function deathPhotos(tx: Prisma.TransactionClient, tenantId: TenantId, campaignId: string): Promise<DeathPhotosView | null> {
  const campaign = UUID.test(campaignId) ? await tx.campaign.findUnique({ where: { id: campaignId }, select: { id: true } }) : null;
  if (campaign === null) return null;
  const lines = effectiveJournal(await new PrismaJournal(tx, tenantId).campaignJournal(campaignId)).filter((line) => line.retraction === null && line.declaration.type === 'Death');
  const counts = new Map<string, { photographed: number; noPhoto: number; unanswered: number }>();
  for (const { declaration } of lines) {
    if (declaration.type !== 'Death') continue;
    const count = counts.get(declaration.authorId) ?? { photographed: 0, noPhoto: 0, unanswered: 0 };
    const answer = declaration.deathEvidence?.kind;
    counts.set(declaration.authorId, {
      photographed: count.photographed + (answer === 'Photographed' ? 1 : 0),
      noPhoto: count.noPhoto + (answer === 'NoPhoto' ? 1 : 0),
      unanswered: count.unanswered + (answer === undefined ? 1 : 0),
    });
  }
  const names = new Map((await tx.user.findMany({ where: { id: { in: [...counts.keys()] } }, select: { id: true, name: true } })).map(({ id, name }) => [id, name]));
  return {
    campaignId,
    caretakers: [...counts.entries()]
      .map(([authorId, count]) => ({ authorId, name: names.get(authorId) ?? '', ...count }))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr')),
  };
}
