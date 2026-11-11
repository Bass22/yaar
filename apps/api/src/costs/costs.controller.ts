import { BadRequestException, Body, ConflictException, Controller, Get, HttpStatus, Inject, NotFoundException, Param, Post, Res } from '@nestjs/common';
import type { Clock, Result } from '@kit';
import { TenantId } from '@domain/journal';
import { unwrap } from '@kit';
import type { CampaignMoneyView, CostRefusal, RecordCostRequest } from '@contracts';
import { CLOCK } from '../auth/clock.token';
import { CurrentSession, Roles, type Session } from '../auth/session';
import { PrismaService } from '../database/prisma.service';
import { campaignMoney, recordCampaignCost, reviseCampaignCost } from './costs';

// The costs of a campaign (P.3): admin only — amounts never go to the caretaker. Online until the
// office's queue (P.7). No route deletes nor rewrites a cost: it is corrected by a counter-entry.
@Roles('admin')
@Controller()
export class CostsController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Get('campaigns/:id/money')
  async money(@CurrentSession() session: Session, @Param('id') id: string): Promise<CampaignMoneyView> {
    const money = await this.prisma.runInTenant(session.tenantId, (tx) => campaignMoney(tx, unwrap(TenantId(session.tenantId)), id));
    if (money === null) throw new NotFoundException();
    return money;
  }

  /** 201 when written, 200 when the same cost was already there. */
  @Post('costs')
  async record(@CurrentSession() session: Session, @Body() body: unknown, @Res({ passthrough: true }) response: { status(code: number): unknown }): Promise<void> {
    const request = requestOf(body);
    answer(await this.prisma.runInTenant(session.tenantId, (tx) => recordCampaignCost(tx, session, request, this.clock.now())), response);
  }

  /** A counter-entry: the cost written again whole. 201 when written, 200 when already there. */
  @Post('costs/:id/revisions')
  async revise(@CurrentSession() session: Session, @Param('id') id: string, @Body() body: unknown, @Res({ passthrough: true }) response: { status(code: number): unknown }): Promise<void> {
    const request = requestOf(body);
    answer(await this.prisma.runInTenant(session.tenantId, (tx) => reviseCampaignCost(tx, session, id, request, this.clock.now())), response);
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const hasExactly = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).sort().join() === [...keys].sort().join();

// Whitelist at the border: each field of its type — never a farm, an author nor an instant.
function requestOf(body: unknown): RecordCostRequest {
  const payment = isObject(body) ? body['payment'] : null;
  const valid =
    isObject(body) &&
    hasExactly(body, ['id', 'campaignId', 'costTypeId', 'spentOn', 'amount', 'note', 'payment', 'receipt']) &&
    ['id', 'campaignId', 'costTypeId', 'spentOn'].every((field) => typeof body[field] === 'string') &&
    typeof body['amount'] === 'number' &&
    (body['note'] === null || typeof body['note'] === 'string') &&
    (body['receipt'] === null || typeof body['receipt'] === 'string') &&
    isObject(payment) &&
    ((hasExactly(payment, ['kind']) && payment['kind'] === 'Paid') || (hasExactly(payment, ['kind', 'counterpartyId']) && payment['kind'] === 'ToPay' && typeof payment['counterpartyId'] === 'string'));
  if (!valid) throw new BadRequestException({ kind: 'InvalidRequest' });
  return body as unknown as RecordCostRequest;
}

function answer(result: Result<'Recorded' | 'Duplicate', CostRefusal>, response: { status(code: number): unknown }): void {
  if (!result.ok) {
    if (result.error.kind === 'CostNotFound') throw new NotFoundException();
    throw result.error.kind === 'CostAlreadyExists' ? new ConflictException(result.error) : new BadRequestException(result.error);
  }
  response.status(result.value === 'Duplicate' ? HttpStatus.OK : HttpStatus.CREATED);
}
