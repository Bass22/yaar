import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import type { Clock } from '@kit';
import type { PriceCatalogView, SetCatalogPriceRequest } from '@contracts';
import { CLOCK } from '../auth/clock.token';
import { CurrentSession, Roles, type Session } from '../auth/session';
import { PrismaService } from '../database/prisma.service';
import { priceCatalog, setCatalogPrice } from './price-catalog';
import { isCanonicalUuid } from '@domain/journal';

// The price catalog (N.5): office only — prices never reach the caretaker (rule 4).
@Roles('admin')
@Controller('price-catalog')
export class PriceCatalogController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Get()
  read(@CurrentSession() session: Session): Promise<PriceCatalogView> {
    return this.prisma.runInTenant(session.tenantId, (tx) => priceCatalog(tx, session.tenantId));
  }

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  async set(@CurrentSession() session: Session, @Body() body: unknown): Promise<void> {
    const request = requestOf(body);
    const result = await this.prisma.runInTenant(session.tenantId, (tx) => setCatalogPrice(tx, session, request, this.clock.now()));
    if (result.ok) return;
    if (result.error.kind === 'CatalogPriceAlreadySet') throw new ConflictException(result.error);
    throw new BadRequestException(result.error);
  }
}

// Whitelist at the border: exactly these four fields, each of its type.
function requestOf(body: unknown): SetCatalogPriceRequest {
  const values = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  const valid =
    values !== null &&
    Object.keys(values).sort().join() === 'costTypeId,id,supplierId,unitPrice' &&
    typeof values['id'] === 'string' &&
    isCanonicalUuid(values['id']) &&
    typeof values['costTypeId'] === 'string' &&
    (values['supplierId'] === null || typeof values['supplierId'] === 'string') &&
    typeof values['unitPrice'] === 'number';
  if (!valid) throw new BadRequestException({ kind: 'InvalidRequest' });
  return values as unknown as SetCatalogPriceRequest;
}
