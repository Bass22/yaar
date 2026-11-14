import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, HttpStatus, Inject, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import type { Clock, Result } from '@kit';
import { COUNTERPARTY_FACES, COUNTERPARTY_KINDS } from '@domain/finance';
import type { ConfigureCounterpartyRequest, CounterpartyRefusal, CounterpartyView, CreateCounterpartyRequest } from '@contracts';
import { CLOCK } from '../auth/clock.token';
import { CurrentSession, Roles, type Session } from '../auth/session';
import { PrismaService } from '../database/prisma.service';
import { archiveCounterparty, configureCounterparty, createCounterparty, listCounterparties } from './counterparties';
import { objectOf } from '../http/body';

// The farm's counterparties (N.3): office only — the caretaker never sees them. No route deletes
// one: it is archived (decision of 2026-11-09).
@Roles('admin')
@Controller('counterparties')
export class CounterpartiesController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Get()
  list(@CurrentSession() session: Session): Promise<CounterpartyView[]> {
    return this.prisma.runInTenant(session.tenantId, (tx) => listCounterparties(tx));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@CurrentSession() session: Session, @Body() body: unknown): Promise<void> {
    const request = createRequestOf(body);
    answer(await this.prisma.runInTenant(session.tenantId, (tx) => createCounterparty(tx, session, request, this.clock.now())));
  }

  @Patch(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async configure(@CurrentSession() session: Session, @Param('id') id: string, @Body() body: unknown): Promise<void> {
    const change = configureRequestOf(body);
    answer(await this.prisma.runInTenant(session.tenantId, (tx) => configureCounterparty(tx, session, id, change, this.clock.now())));
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.NO_CONTENT)
  async archive(@CurrentSession() session: Session, @Param('id') id: string): Promise<void> {
    answer(await this.prisma.runInTenant(session.tenantId, (tx) => archiveCounterparty(tx, session, id, this.clock.now())));
  }
}

const isKind = (value: unknown): value is CreateCounterpartyRequest['kind'] => (COUNTERPARTY_KINDS as readonly unknown[]).includes(value);
const isFace = (value: unknown): value is CreateCounterpartyRequest['face'] => (COUNTERPARTY_FACES as readonly unknown[]).includes(value);

// Whitelist at the border: id, kind, name, face — never a farm.
function createRequestOf(body: unknown): CreateCounterpartyRequest {
  const values = objectOf(body);
  const { id, kind, name, face, advancesExpenses } = values;
  const keys = Object.keys(values).sort().join();
  if (
    (keys !== 'face,id,kind,name' && keys !== 'advancesExpenses,face,id,kind,name') ||
    typeof id !== 'string' ||
    !isKind(kind) ||
    typeof name !== 'string' ||
    !isFace(face) ||
    (advancesExpenses !== undefined && typeof advancesExpenses !== 'boolean')
  ) {
    throw new BadRequestException({ kind: 'InvalidRequest' });
  }
  return { id, kind, name, face, ...(advancesExpenses === undefined ? {} : { advancesExpenses }) };
}

// At least one of name, face and « advances expenses », each of its type; never the kind, never a farm.
function configureRequestOf(body: unknown): ConfigureCounterpartyRequest {
  const values = objectOf(body);
  const keys = Object.keys(values);
  const valid =
    keys.length > 0 &&
    keys.every((key) => key === 'name' || key === 'face' || key === 'advancesExpenses') &&
    (!('name' in values) || typeof values['name'] === 'string') &&
    (!('advancesExpenses' in values) || typeof values['advancesExpenses'] === 'boolean') &&
    (!('face' in values) || isFace(values['face']));
  if (!valid) {
    throw new BadRequestException({ kind: 'InvalidRequest' });
  }
  return values as ConfigureCounterpartyRequest;
}

function answer(result: Result<void, CounterpartyRefusal>): void {
  if (result.ok) {
    return;
  }
  switch (result.error.kind) {
    case 'CounterpartyAlreadyExists':
      throw new ConflictException(result.error);
    case 'CounterpartyNotFound':
      throw new NotFoundException();
    default:
      throw new BadRequestException(result.error);
  }
}
