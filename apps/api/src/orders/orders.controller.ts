import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, HttpStatus, Inject, NotFoundException, Param, Post, Put, Res } from '@nestjs/common';
import type { Clock, Result } from '@kit';
import type { DraftOrderRequest, OrderRefusal, OrderView, RecordPaymentRequest } from '@contracts';
import { CLOCK } from '../auth/clock.token';
import { CurrentSession, Roles, type Session } from '../auth/session';
import { PrismaService } from '../database/prisma.service';
import { announcePurchaseOrder, closePurchaseOrder, draftPurchaseOrder, listOrders, payPurchaseOrder, revisePurchaseOrder } from './orders';

// The farm's purchase orders (Q.4): admin only — prices never go to the caretaker. Online, like
// the rest of the office (rule 3). No route deletes an order: it is closed.
@Roles('admin')
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Get()
  list(@CurrentSession() session: Session): Promise<OrderView[]> {
    return this.prisma.runInTenant(session.tenantId, (tx) => listOrders(tx, session.tenantId));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async draft(@CurrentSession() session: Session, @Body() body: unknown): Promise<void> {
    const request = requestOf(body);
    answer(await this.prisma.runInTenant(session.tenantId, (tx) => draftPurchaseOrder(tx, session, request, this.clock.now())));
  }

  @Put(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revise(@CurrentSession() session: Session, @Param('id') id: string, @Body() body: unknown): Promise<void> {
    const request = requestOf(body);
    answer(await this.prisma.runInTenant(session.tenantId, (tx) => revisePurchaseOrder(tx, session, id, request, this.clock.now())));
  }

  @Post(':id/announce')
  @HttpCode(HttpStatus.NO_CONTENT)
  async announce(@CurrentSession() session: Session, @Param('id') id: string): Promise<void> {
    answer(await this.prisma.runInTenant(session.tenantId, (tx) => announcePurchaseOrder(tx, session, id, this.clock.now())));
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.NO_CONTENT)
  async close(@CurrentSession() session: Session, @Param('id') id: string): Promise<void> {
    answer(await this.prisma.runInTenant(session.tenantId, (tx) => closePurchaseOrder(tx, session, id, this.clock.now())));
  }

  /** A payment (Q.9): 201 when recorded, 200 when the same payment was already there. */
  @Post(':id/payments')
  async pay(@CurrentSession() session: Session, @Param('id') id: string, @Body() body: unknown, @Res({ passthrough: true }) response: { status(code: number): unknown }): Promise<void> {
    const request = paymentOf(body);
    const result = await this.prisma.runInTenant(session.tenantId, (tx) => payPurchaseOrder(tx, session, id, request, this.clock.now()));
    answer(result.ok ? { ok: true, value: undefined } : result);
    response.status(result.ok && result.value === 'Duplicate' ? HttpStatus.OK : HttpStatus.CREATED);
  }
}

// Whitelist at the border: the four fields and who paid (R.4), each of its type — never an order, a farm or an author.
function paymentOf(body: unknown): RecordPaymentRequest {
  const valid =
    isObject(body) &&
    (hasExactly(body, ['id', 'paidOn', 'amount', 'method']) || hasExactly(body, ['id', 'paidOn', 'amount', 'method', 'paidBy'])) &&
    typeof body['id'] === 'string' &&
    typeof body['paidOn'] === 'string' &&
    typeof body['amount'] === 'number' &&
    typeof body['method'] === 'string' &&
    (body['paidBy'] === undefined || body['paidBy'] === null || typeof body['paidBy'] === 'string');
  if (!valid) {
    throw new BadRequestException({ kind: 'InvalidRequest' });
  }
  return body as unknown as RecordPaymentRequest;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const hasExactly = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).sort().join() === [...keys].sort().join();

// Whitelist at the border: the header and the lines, each field of its type — never a farm, a state or a date of announcement.
function requestOf(body: unknown): DraftOrderRequest {
  const valid =
    isObject(body) &&
    hasExactly(body, ['id', 'supplierId', 'campaignId', 'orderDay', 'reference', 'lines']) &&
    ['id', 'supplierId', 'campaignId', 'orderDay'].every((field) => typeof body[field] === 'string') &&
    (body['reference'] === null || typeof body['reference'] === 'string') &&
    Array.isArray(body['lines']) &&
    body['lines'].every(
      (line: unknown) =>
        isObject(line) && hasExactly(line, ['id', 'costTypeId', 'quantity', 'unitPrice']) && typeof line['id'] === 'string' && typeof line['costTypeId'] === 'string' && typeof line['quantity'] === 'number' && typeof line['unitPrice'] === 'number',
    );
  if (!valid) {
    throw new BadRequestException({ kind: 'InvalidRequest' });
  }
  return body as unknown as DraftOrderRequest;
}

const CONFLICTS: ReadonlySet<OrderRefusal['kind']> = new Set(['OrderAlreadyExists', 'OrderAnnounced', 'OrderAlreadyAnnounced', 'OrderNotAnnounced', 'OrderClosed', 'OrderFullyReceived', 'PaymentAlreadyExists']);

function answer(result: Result<void, OrderRefusal>): void {
  if (result.ok) {
    return;
  }
  if (result.error.kind === 'OrderNotFound') {
    throw new NotFoundException();
  }
  throw CONFLICTS.has(result.error.kind) ? new ConflictException(result.error) : new BadRequestException(result.error);
}
