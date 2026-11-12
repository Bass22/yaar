import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, HttpStatus, Inject, NotFoundException, Param, Post, Put } from '@nestjs/common';
import { unwrap, type Clock, type Result } from '@kit';
import { TenantId } from '@domain/journal';
import type { BudgetRefusal, BudgetView, RecordBudgetRequest, CampaignClosingRefusal, ClosedLotView, CloseCampaignRequest, ClosingReportView, CampaignOpeningRefusal, OpenCampaignRequest, TrackingView } from '@contracts';
import { CLOCK } from '../auth/clock.token';
import { CurrentSession, Roles, type Session } from '../auth/session';
import { PrismaService } from '../database/prisma.service';
import { campaignBudget, recordCampaignBudget } from './budget';
import { campaignClosingReport, closeCampaign, closedCampaigns } from './closing';
import { openCampaign } from './open-campaign';
import { campaignTracking } from './tracking';

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

  /** The closed campaigns, their reports one tap away (X.2). Before `:id`, which is not a word. */
  @Get('closed')
  async closed(@CurrentSession() session: Session): Promise<ClosedLotView[]> {
    return this.prisma.runInTenant(session.tenantId, (tx) => closedCampaigns(tx));
  }

  /** Closing a campaign (X.2): online, at once, traced. */
  @Post(':id/closing')
  @HttpCode(HttpStatus.NO_CONTENT)
  async close(@CurrentSession() session: Session, @Param('id') id: string, @Body() body: unknown): Promise<void> {
    const request = closeRequestOf(body);
    answerClosing(await this.prisma.runInTenant(session.tenantId, (tx) => closeCampaign(tx, session, id, request, this.clock.now())));
  }

  /** The report exists only at the closing (X.2): 404 while the campaign runs. */
  @Get(':id/closing-report')
  async closingReport(@CurrentSession() session: Session, @Param('id') id: string): Promise<ClosingReportView> {
    const view = await this.prisma.runInTenant(session.tenantId, (tx) => campaignClosingReport(tx, unwrap(TenantId(session.tenantId)), id));
    if (view === null) throw new NotFoundException();
    return view;
  }

  /** The budget of a campaign by category, against its committed cost (S.1, S.3). */
  @Get(':id/budget')
  async budget(@CurrentSession() session: Session, @Param('id') id: string): Promise<BudgetView> {
    const view = await this.prisma.runInTenant(session.tenantId, (tx) => campaignBudget(tx, unwrap(TenantId(session.tenantId)), id));
    if (view === null) throw new NotFoundException();
    return view;
  }

  /** Writing the budget (S.1): online, the latest written counts, traced. */
  @Put(':id/budget')
  @HttpCode(HttpStatus.NO_CONTENT)
  async recordBudget(@CurrentSession() session: Session, @Param('id') id: string, @Body() body: unknown): Promise<void> {
    const request = budgetRequestOf(body);
    answerBudget(await this.prisma.runInTenant(session.tenantId, (tx) => recordCampaignBudget(tx, session, id, request, this.clock.now())));
  }

  /** The « Suivi » of a lot (V.3): money is in it, so the admin only. */
  @Get(':id/tracking')
  async tracking(@CurrentSession() session: Session, @Param('id') id: string): Promise<TrackingView> {
    const view = await this.prisma.runInTenant(session.tenantId, (tx) => campaignTracking(tx, unwrap(TenantId(session.tenantId)), id, this.clock.now()));
    if (view === null) throw new NotFoundException();
    return view;
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

// Whitelist at the border: exactly the three fields, each leftover exactly its three fields.
function closeRequestOf(body: unknown): CloseCampaignRequest {
  const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
  const sameKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).sort().join() === [...keys].sort().join();
  const valid =
    isRecord(body) &&
    sameKeys(body, ['comment', 'leftovers', 'leftoversTo']) &&
    (body['comment'] === null || typeof body['comment'] === 'string') &&
    (body['leftoversTo'] === null || typeof body['leftoversTo'] === 'string') &&
    Array.isArray(body['leftovers']) &&
    (body['leftovers'] as unknown[]).every(
      (leftover) => isRecord(leftover) && sameKeys(leftover, ['costTypeId', 'opened', 'whole']) && typeof leftover['costTypeId'] === 'string' && typeof leftover['whole'] === 'number' && typeof leftover['opened'] === 'boolean',
    );
  if (!valid) {
    throw new BadRequestException({ kind: 'InvalidRequest' });
  }
  return body as unknown as CloseCampaignRequest;
}

function answerClosing(result: Result<void, CampaignClosingRefusal>): void {
  if (result.ok) {
    return;
  }
  switch (result.error.kind) {
    case 'CampaignNotFound':
      throw new NotFoundException();
    case 'CampaignClosed':
      throw new ConflictException(result.error);
    default:
      throw new BadRequestException(result.error);
  }
}

// Whitelist at the border: an identifier and lines of a category and an amount, nothing else.
function budgetRequestOf(body: unknown): RecordBudgetRequest {
  const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
  const valid =
    isRecord(body) &&
    Object.keys(body).sort().join() === 'id,lines' &&
    typeof body['id'] === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(body['id']) &&
    Array.isArray(body['lines']) &&
    (body['lines'] as unknown[]).every((line) => isRecord(line) && Object.keys(line).sort().join() === 'amount,category' && typeof line['category'] === 'string' && (line['amount'] === null || typeof line['amount'] === 'number'));
  if (!valid) {
    throw new BadRequestException({ kind: 'InvalidRequest' });
  }
  return body as unknown as RecordBudgetRequest;
}

function answerBudget(result: Result<void, BudgetRefusal>): void {
  if (result.ok) {
    return;
  }
  switch (result.error.kind) {
    case 'CampaignNotFound':
      throw new NotFoundException();
    case 'CampaignClosed':
    case 'BudgetAlreadyRecorded':
      throw new ConflictException(result.error);
    default:
      throw new BadRequestException(result.error);
  }
}
