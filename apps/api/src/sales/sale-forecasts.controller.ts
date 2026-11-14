import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, HttpStatus, Inject, NotFoundException, Param, Post, Put } from '@nestjs/common';
import { type Clock, type Result } from '@kit';
import { isCanonicalUuid } from '@domain/journal';
import type { RecordSaleForecastRequest, SaleForecastsView } from '@contracts';
import { CLOCK } from '../auth/clock.token';
import { CurrentSession, Roles, type Session } from '../auth/session';
import { PrismaService } from '../database/prisma.service';
import { recordForecast, saleForecasts, withdrawForecast } from './sale-forecasts';

// The planned sales of a flock (W.4). Admin only: money is in it.
@Roles('admin')
@Controller('campaigns/:id/sale-forecasts')
export class SaleForecastsController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Get()
  async read(@CurrentSession() session: Session, @Param('id') id: string): Promise<SaleForecastsView> {
    const view = await this.prisma.runInTenant(session.tenantId, (tx) => saleForecasts(tx, session.tenantId, id));
    if (view === null) throw new NotFoundException();
    return view;
  }

  @Put(':forecastId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async record(@CurrentSession() session: Session, @Param('id') id: string, @Param('forecastId') forecastId: string, @Body() body: unknown): Promise<void> {
    const request = requestOf(body);
    answer(await this.prisma.runInTenant(session.tenantId, (tx) => recordForecast(tx, session, id, forecastId, request, this.clock.now())));
  }

  @Post(':forecastId/withdraw')
  @HttpCode(HttpStatus.NO_CONTENT)
  async withdraw(@CurrentSession() session: Session, @Param('id') id: string, @Param('forecastId') forecastId: string, @Body() body: unknown): Promise<void> {
    const values = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
    if (values === null || Object.keys(values).join() !== 'id' || typeof values['id'] !== 'string' || !isCanonicalUuid(values['id'])) throw new BadRequestException({ kind: 'InvalidRequest' });
    const writing = values['id'];
    answer(await this.prisma.runInTenant(session.tenantId, (tx) => withdrawForecast(tx, session, id, forecastId, writing, this.clock.now())));
  }
}

// Whitelist at the border: exactly these six fields, each of its form.
function requestOf(body: unknown): RecordSaleForecastRequest {
  const values = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  const pricing = values?.['pricing'];
  const valid =
    values !== null &&
    Object.keys(values).sort().join() === 'averageWeight,birds,buyerId,id,pricing,week' &&
    typeof values['id'] === 'string' &&
    isCanonicalUuid(values['id']) &&
    typeof values['buyerId'] === 'string' &&
    typeof values['week'] === 'string' &&
    typeof values['birds'] === 'number' &&
    (values['averageWeight'] === null || typeof values['averageWeight'] === 'number') &&
    typeof pricing === 'object' &&
    pricing !== null &&
    Object.keys(pricing).sort().join() === 'kind,price' &&
    ((pricing as Record<string, unknown>)['kind'] === 'PerBird' || (pricing as Record<string, unknown>)['kind'] === 'PerKilo') &&
    typeof (pricing as Record<string, unknown>)['price'] === 'number';
  if (!valid) throw new BadRequestException({ kind: 'InvalidRequest' });
  return values as unknown as RecordSaleForecastRequest;
}

function answer(result: Result<void, { readonly kind: string }>): void {
  if (result.ok) return;
  if (result.error.kind === 'CampaignNotFound') throw new NotFoundException();
  if (result.error.kind === 'CampaignClosed') throw new ConflictException(result.error);
  throw new BadRequestException(result.error);
}
