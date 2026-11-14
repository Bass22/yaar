import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, HttpStatus, Inject, NotFoundException, Param, Post, Put } from '@nestjs/common';
import { type Clock, type Result } from '@kit';
import { isCanonicalUuid } from '@domain/journal';
import type { PlanReceptionRequest, ReceptionsView } from '@contracts';
import { CLOCK } from '../auth/clock.token';
import { CurrentSession, Roles, type Session } from '../auth/session';
import { AfterCommit, type AfterCommitTask } from '../database/after-commit';
import { PrismaService } from '../database/prisma.service';
import { ReceptionAlerts } from '../notifications/reception-alerts';
import { listReceptions, planOrderReception, withdrawReception } from './receptions';

// The planned receptions of the orders (Q.14). Admin only: the caretaker has his delivery card.
@Roles('admin')
@Controller()
export class ReceptionsController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly alerts: ReceptionAlerts,
  ) {}

  @Get('receptions')
  list(@CurrentSession() session: Session): Promise<ReceptionsView> {
    return this.prisma.runInTenant(session.tenantId, (tx) => listReceptions(tx, session.tenantId, this.clock.now()));
  }

  @Put('orders/:id/receptions/:receptionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async plan(@CurrentSession() session: Session, @Param('id') id: string, @Param('receptionId') receptionId: string, @Body() body: unknown, @AfterCommit() later: (task: AfterCommitTask) => void): Promise<void> {
    const request = requestOf(body);
    if (!isCanonicalUuid(id)) throw new NotFoundException();
    answer(await this.prisma.runInTenant(session.tenantId, (tx) => planOrderReception(tx, session, id, receptionId, request, this.clock.now())));
    // Its day has come already — today or a past day: the caretakers are told now, once committed (Q.15).
    later(() => this.alerts.written(session.tenantId, receptionId));
  }

  @Post('orders/:id/receptions/:receptionId/withdraw')
  @HttpCode(HttpStatus.NO_CONTENT)
  async withdraw(@CurrentSession() session: Session, @Param('id') id: string, @Param('receptionId') receptionId: string, @Body() body: unknown): Promise<void> {
    const values = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
    if (values === null || Object.keys(values).join() !== 'id' || typeof values['id'] !== 'string' || !isCanonicalUuid(values['id']) || !isCanonicalUuid(receptionId)) throw new BadRequestException({ kind: 'InvalidRequest' });
    if (!isCanonicalUuid(id)) throw new NotFoundException();
    const writing = values['id'];
    answer(await this.prisma.runInTenant(session.tenantId, (tx) => withdrawReception(tx, session, id, receptionId, writing, this.clock.now())));
  }
}

// Whitelist at the border: exactly these three fields, each line its two.
function requestOf(body: unknown): PlanReceptionRequest {
  const values = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  const lines = values?.['lines'];
  const valid =
    values !== null &&
    Object.keys(values).sort().join() === 'id,lines,plannedOn' &&
    typeof values['id'] === 'string' &&
    isCanonicalUuid(values['id']) &&
    typeof values['plannedOn'] === 'string' &&
    Array.isArray(lines) &&
    lines.every((line: unknown) => typeof line === 'object' && line !== null && Object.keys(line).sort().join() === 'orderLineId,quantity' && typeof (line as Record<string, unknown>)['orderLineId'] === 'string' && typeof (line as Record<string, unknown>)['quantity'] === 'number');
  if (!valid) throw new BadRequestException({ kind: 'InvalidRequest' });
  return values as unknown as PlanReceptionRequest;
}

function answer(result: Result<void, { readonly kind: string }>): void {
  if (result.ok) return;
  if (result.error.kind === 'OrderNotFound') throw new NotFoundException();
  if (result.error.kind === 'OrderNotReceiving') throw new ConflictException(result.error);
  throw new BadRequestException(result.error);
}
