import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, HttpStatus, Inject, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import type { Clock, Result } from '@kit';
import type { ConfigureCostTypeRequest, CostTypeRefusal, CostTypeView, CreateCostTypeRequest } from '@contracts';
import { CLOCK } from '../auth/clock.token';
import { CurrentSession, Roles, type Session } from '../auth/session';
import { PrismaService } from '../database/prisma.service';
import { archiveCostType, configureCostType, createCostType, listCostTypes } from './cost-types';

// The farm's cost types (N.2): office only. No route deletes one: it is archived (decision of 2026-11-09).
@Roles('admin')
@Controller('cost-types')
export class CostTypesController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Get()
  list(@CurrentSession() session: Session): Promise<CostTypeView[]> {
    return this.prisma.runInTenant(session.tenantId, (tx) => listCostTypes(tx));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@CurrentSession() session: Session, @Body() body: unknown): Promise<void> {
    const request = createRequestOf(body);
    answer(await this.prisma.runInTenant(session.tenantId, (tx) => createCostType(tx, session, request, this.clock.now())));
  }

  @Patch(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async configure(@CurrentSession() session: Session, @Param('id') id: string, @Body() body: unknown): Promise<void> {
    const change = configureRequestOf(body);
    answer(await this.prisma.runInTenant(session.tenantId, (tx) => configureCostType(tx, session, id, change, this.clock.now())));
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.NO_CONTENT)
  async archive(@CurrentSession() session: Session, @Param('id') id: string): Promise<void> {
    answer(await this.prisma.runInTenant(session.tenantId, (tx) => archiveCostType(tx, session, id, this.clock.now())));
  }
}

const isBehaviour = (value: unknown): value is 'Fixed' | 'Variable' => value === 'Fixed' || value === 'Variable';

function objectOf(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException({ kind: 'InvalidRequest' });
  }
  return body as Record<string, unknown>;
}

// Whitelist at the border: id, category, name, and the fixed/variable flag if chosen — never a farm, never « orderable ».
// Whether the category is one of the base is the use case's to say, once.
function createRequestOf(body: unknown): CreateCostTypeRequest {
  const values = objectOf(body);
  const { id, category, name, behaviour } = values;
  const keys = Object.keys(values).filter((key) => key !== 'behaviour').sort().join();
  if (keys !== 'category,id,name' || typeof id !== 'string' || typeof category !== 'string' || typeof name !== 'string' || (behaviour !== undefined && !isBehaviour(behaviour))) {
    throw new BadRequestException({ kind: 'InvalidRequest' });
  }
  return { id, category: category as CreateCostTypeRequest['category'], name, ...(behaviour === undefined ? {} : { behaviour }) };
}

// At least one of name and fixed/variable; never the category.
function configureRequestOf(body: unknown): ConfigureCostTypeRequest {
  const values = objectOf(body);
  const keys = Object.keys(values);
  const valid =
    keys.length > 0 &&
    keys.every((key) => key === 'name' || key === 'behaviour') &&
    (!('name' in values) || typeof values['name'] === 'string') &&
    (!('behaviour' in values) || isBehaviour(values['behaviour']));
  if (!valid) {
    throw new BadRequestException({ kind: 'InvalidRequest' });
  }
  return values as ConfigureCostTypeRequest;
}

function answer(result: Result<void, CostTypeRefusal>): void {
  if (result.ok) {
    return;
  }
  switch (result.error.kind) {
    case 'CostTypeAlreadyExists':
      throw new ConflictException(result.error);
    case 'CostTypeNotFound':
      throw new NotFoundException();
    default:
      throw new BadRequestException(result.error);
  }
}
