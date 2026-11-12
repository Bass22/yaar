import { BadRequestException, Body, ConflictException, Controller, Get, HttpStatus, Inject, NotFoundException, Param, Post, Res } from '@nestjs/common';
import { unwrap, type Clock, type Result } from '@kit';
import { TenantId } from '@domain/journal';
import type { RecordSaleRequest, SaleReceiptRequest, SaleRefusal, SalesView } from '@contracts';
import { CLOCK } from '../auth/clock.token';
import { CurrentSession, Roles, type Session } from '../auth/session';
import { PrismaService } from '../database/prisma.service';
import { campaignSales, receiveForSale, recordFarmSale } from './sales';

// The sales of a campaign (W.3): admin only — amounts never go to the caretaker. No route changes
// nor deletes a sale or a receipt.
@Roles('admin')
@Controller()
export class SalesController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Get('campaigns/:id/sales')
  async sales(@CurrentSession() session: Session, @Param('id') id: string): Promise<SalesView> {
    const view = await this.prisma.runInTenant(session.tenantId, (tx) => campaignSales(tx, unwrap(TenantId(session.tenantId)), id));
    if (view === null) throw new NotFoundException();
    return view;
  }

  /** 201 when written, 200 when the same sale was already there. */
  @Post('sales')
  async record(@CurrentSession() session: Session, @Body() body: unknown, @Res({ passthrough: true }) response: { status(code: number): unknown }): Promise<void> {
    const request = saleOf(body);
    answer(await this.prisma.runInTenant(session.tenantId, (tx) => recordFarmSale(tx, session, request, this.clock.now())), response);
  }

  /** Money received later for a sale. 201 when written, 200 when already there. */
  @Post('sales/:id/receipts')
  async receive(@CurrentSession() session: Session, @Param('id') id: string, @Body() body: unknown, @Res({ passthrough: true }) response: { status(code: number): unknown }): Promise<void> {
    const request = receiptOf(body);
    answer(await this.prisma.runInTenant(session.tenantId, (tx) => receiveForSale(tx, session, id, request, this.clock.now())), response);
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const keysAre = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).sort().join() === [...keys].sort().join();

// Whitelist at the border: each field of its type — never an amount, a farm nor an author.
function saleOf(body: unknown): RecordSaleRequest {
  const pricing = isObject(body) ? body['pricing'] : null;
  const now = isObject(body) ? body['receivedNow'] : null;
  const valid =
    isObject(body) &&
    keysAre(body, ['id', 'campaignId', 'buyerId', 'soldOn', 'birds', 'pricing', 'receivedNow']) &&
    ['id', 'campaignId', 'buyerId', 'soldOn'].every((field) => typeof body[field] === 'string') &&
    typeof body['birds'] === 'number' &&
    isObject(pricing) &&
    ((keysAre(pricing, ['kind', 'unitPrice']) && pricing['kind'] === 'PerBird' && typeof pricing['unitPrice'] === 'number') ||
      (keysAre(pricing, ['kind', 'grams', 'pricePerKilo']) && pricing['kind'] === 'PerKilo' && typeof pricing['grams'] === 'number' && typeof pricing['pricePerKilo'] === 'number')) &&
    (now === null || (isObject(now) && keysAre(now, ['id', 'amount', 'method']) && typeof now['id'] === 'string' && typeof now['amount'] === 'number' && typeof now['method'] === 'string'));
  if (!valid) throw new BadRequestException({ kind: 'InvalidRequest' });
  return body as unknown as RecordSaleRequest;
}

function receiptOf(body: unknown): SaleReceiptRequest {
  const valid = isObject(body) && keysAre(body, ['id', 'paidOn', 'amount', 'method']) && typeof body['id'] === 'string' && typeof body['paidOn'] === 'string' && typeof body['amount'] === 'number' && typeof body['method'] === 'string';
  if (!valid) throw new BadRequestException({ kind: 'InvalidRequest' });
  return body as unknown as SaleReceiptRequest;
}

function answer(result: Result<'Recorded' | 'Duplicate', SaleRefusal>, response: { status(code: number): unknown }): void {
  if (!result.ok) {
    if (result.error.kind === 'SaleNotFound') throw new NotFoundException();
    throw result.error.kind === 'SaleAlreadyExists' || result.error.kind === 'SaleReceiptAlreadyExists' ? new ConflictException(result.error) : new BadRequestException(result.error);
  }
  response.status(result.value === 'Duplicate' ? HttpStatus.OK : HttpStatus.CREATED);
}
