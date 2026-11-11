import { BadRequestException, Body, ConflictException, Controller, Get, HttpStatus, Inject, Post, Res } from '@nestjs/common';
import { unwrap, type Clock } from '@kit';
import { TenantId } from '@domain/journal';
import type { LedgerView, RecordSettlementRequest } from '@contracts';
import { CLOCK } from '../auth/clock.token';
import { CurrentSession, Roles, type Session } from '../auth/session';
import { PrismaService } from '../database/prisma.service';
import { farmLedger, recordFarmSettlement } from './ledger';

// « Qui doit quoi » (R.3): admin only — balances never go to the caretaker. Online until the
// office's queue (P.7). No route changes nor deletes a settlement.
@Roles('admin')
@Controller()
export class LedgerController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Get('ledger')
  ledger(@CurrentSession() session: Session): Promise<LedgerView> {
    return this.prisma.runInTenant(session.tenantId, (tx) => farmLedger(tx, unwrap(TenantId(session.tenantId))));
  }

  /** 201 when written, 200 when the same settlement was already there. */
  @Post('settlements')
  async settle(@CurrentSession() session: Session, @Body() body: unknown, @Res({ passthrough: true }) response: { status(code: number): unknown }): Promise<void> {
    const request = requestOf(body);
    const result = await this.prisma.runInTenant(session.tenantId, (tx) => recordFarmSettlement(tx, session, request, this.clock.now()));
    if (!result.ok) throw result.error.kind === 'SettlementAlreadyExists' ? new ConflictException(result.error) : new BadRequestException(result.error);
    response.status(result.value === 'Duplicate' ? HttpStatus.OK : HttpStatus.CREATED);
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

// Whitelist at the border: the six fields, each of its type — never a farm, an author nor a balance.
function requestOf(body: unknown): RecordSettlementRequest {
  const valid =
    isObject(body) &&
    Object.keys(body).sort().join() === ['amount', 'counterpartyId', 'direction', 'id', 'method', 'paidOn'].join() &&
    ['id', 'counterpartyId', 'paidOn', 'method', 'direction'].every((field) => typeof body[field] === 'string') &&
    typeof body['amount'] === 'number';
  if (!valid) throw new BadRequestException({ kind: 'InvalidRequest' });
  return body as unknown as RecordSettlementRequest;
}
