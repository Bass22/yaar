import { BadRequestException, Body, ConflictException, Controller, HttpCode, HttpStatus, Inject, NotFoundException, Post } from '@nestjs/common';
import type { Clock, Result } from '@kit';
import type { CampaignOpeningRefusal, OpenCampaignRequest } from '@contracts';
import { CLOCK } from '../auth/clock.token';
import { CurrentSession, Roles, type Session } from '../auth/session';
import { PrismaService } from '../database/prisma.service';
import { openCampaign } from './open-campaign';

// The campaigns of the farm (O.2): opened by the admin, in the tenant transaction of the request.
@Roles('admin')
@Controller('campaigns')
export class CampaignsController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async open(@CurrentSession() session: Session, @Body() body: unknown): Promise<void> {
    const request = openRequestOf(body);
    answer(await this.prisma.runInTenant(session.tenantId, (tx) => openCampaign(tx, session, request, this.clock.now())));
  }
}

const TEXT_FIELDS = ['id', 'placementDay', 'siteId', 'strain'] as const;
const NUMBER_FIELDS = ['plannedDuration', 'plannedHeadcount'] as const;

// Whitelist at the border: exactly these six fields, each of its type — never a farm, never a closing.
function openRequestOf(body: unknown): OpenCampaignRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException({ kind: 'InvalidRequest' });
  }
  const values = body as Record<string, unknown>;
  const valid =
    Object.keys(values).sort().join() === [...TEXT_FIELDS, ...NUMBER_FIELDS].sort().join() &&
    TEXT_FIELDS.every((field) => typeof values[field] === 'string') &&
    NUMBER_FIELDS.every((field) => typeof values[field] === 'number');
  if (!valid) {
    throw new BadRequestException({ kind: 'InvalidRequest' });
  }
  return values as unknown as OpenCampaignRequest;
}

function answer(result: Result<void, CampaignOpeningRefusal>): void {
  if (result.ok) {
    return;
  }
  switch (result.error.kind) {
    case 'CampaignAlreadyExists':
      throw new ConflictException(result.error);
    case 'SiteNotFound':
      throw new NotFoundException();
    default:
      throw new BadRequestException(result.error);
  }
}
