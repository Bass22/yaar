import { err, ok, type Result } from '@kit';
import { businessDayAt, TimeZone, validateCampaignOpening, type Refusal } from '@domain/journal';
import { Prisma } from '@prisma/client';
import type { CampaignOpeningRefusal, OpenCampaignRequest } from '@contracts';
import { recordAudit } from '../audit/audit';
import type { Session } from '../auth/session';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The admin opens a campaign on a site of the farm of the session (O.2). The domain judges it on
 * the site's today; it is running at once, so the site's notebook shows it. The opening is traced.
 */
export async function openCampaign(tx: Prisma.TransactionClient, admin: Session, request: OpenCampaignRequest, now: Date): Promise<Result<void, CampaignOpeningRefusal>> {
  if (!UUID.test(request.id)) {
    return err({ kind: 'InvalidRequest' });
  }
  const site = UUID.test(request.siteId) ? await tx.site.findUnique({ where: { id: request.siteId }, select: { timeZone: true } }) : null;
  const timeZone = site === null ? null : TimeZone(site.timeZone);
  if (timeZone === null || !timeZone.ok) {
    return err({ kind: 'SiteNotFound' });
  }
  const opening = validateCampaignOpening(request, businessDayAt(now, timeZone.value));
  if (!opening.ok) {
    return err(openingRefusalOf(opening.error));
  }
  const { strain, plannedHeadcount, placementDay, plannedDuration } = opening.value;
  try {
    await tx.campaign.create({
      data: { id: request.id, tenantId: admin.tenantId, siteId: request.siteId, strain: strain.code, plannedHeadcount, placementDay: new Date(placementDay), plannedDuration },
    });
  } catch (error) {
    // The identifier is taken — here, or in another farm, which this transaction does not see.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return err({ kind: 'CampaignAlreadyExists' });
    }
    throw error;
  }
  await recordAudit(tx, admin.tenantId, { action: 'CampaignOpened', actorId: admin.userId, subjectId: request.id, siteId: request.siteId, deviceId: admin.deviceId }, now);
  return ok(undefined);
}

// The domain's refusal list is shared by every rule: an opening can only end on these.
function openingRefusalOf(refusal: Refusal): CampaignOpeningRefusal {
  switch (refusal.kind) {
    case 'UnknownStrain':
    case 'InvalidBusinessDay':
    case 'PlacementInFuture':
    case 'PlacementTooOld':
    case 'InvalidQuantity':
    case 'InvalidPlannedDuration':
      return refusal;
    default:
      throw new Error(`Unexpected refusal while opening a campaign: ${refusal.kind}`);
  }
}
