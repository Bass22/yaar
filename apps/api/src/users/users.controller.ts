import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, HttpCode, HttpStatus, Inject, NotFoundException, Param, Post } from '@nestjs/common';
import type { Clock, Result } from '@kit';
import type { CreateAccountRequest, ProvisionalPin } from '@contracts';
import { PIN_HASHER, type PinHasher } from '../auth/pin-hasher';
import { createAccount, resetPin, type TeamAccountRefusal } from './team-accounts';
import { CLOCK } from '../auth/clock.token';
import { CurrentSession, Roles, type Session } from '../auth/session';
import { PrismaService } from '../database/prisma.service';
import { blockAccount, signOutEverywhere, unblockAccount, type AccountAccessRefusal } from './account-access';

// What the admin does to the accounts of the team (E.4). Admin only; every action runs in the
// tenant transaction of the request.
@Roles('admin')
@Controller('users')
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PIN_HASHER) private readonly hasher: PinHasher,
  ) {}

  @Post()
  async create(@CurrentSession() session: Session, @Body() body: unknown) {
    const request = createAccountRequestOf(body);
    const result = await this.prisma.runInTenant(session.tenantId, (tx) =>
      createAccount(tx, { prisma: this.prisma, hasher: this.hasher }, session, request, this.clock.now()),
    );
    return teamAnswer(result);
  }

  @Post(':userId/reset-pin')
  @HttpCode(HttpStatus.OK)
  async resetPin(@CurrentSession() session: Session, @Param('userId') userId: string): Promise<ProvisionalPin> {
    return teamAnswer(await this.prisma.runInTenant(session.tenantId, (tx) => resetPin(tx, this.hasher, userId, this.clock.now())));
  }

  @Post(':userId/block')
  @HttpCode(HttpStatus.NO_CONTENT)
  async block(@CurrentSession() session: Session, @Param('userId') userId: string): Promise<void> {
    answer(await this.prisma.runInTenant(session.tenantId, (tx) => blockAccount(tx, session, userId, this.clock.now())));
  }

  @Post(':userId/unblock')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unblock(@CurrentSession() session: Session, @Param('userId') userId: string): Promise<void> {
    answer(await this.prisma.runInTenant(session.tenantId, (tx) => unblockAccount(tx, userId)));
  }

  @Post(':userId/sign-out-everywhere')
  @HttpCode(HttpStatus.NO_CONTENT)
  async signOutEverywhere(@CurrentSession() session: Session, @Param('userId') userId: string): Promise<void> {
    answer(await this.prisma.runInTenant(session.tenantId, (tx) => signOutEverywhere(tx, userId, this.clock.now())));
  }
}

// Whitelist at the border: exactly id, phone and name — neither a role, nor a PIN, nor a tenant.
function createAccountRequestOf(body: unknown): CreateAccountRequest {
  const fields = ['id', 'name', 'phone'];
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException();
  }
  const values = body as Record<string, unknown>;
  if (Object.keys(values).sort().join() !== fields.join() || fields.some((field) => typeof values[field] !== 'string')) {
    throw new BadRequestException();
  }
  return { id: values['id'] as string, phone: values['phone'] as string, name: values['name'] as string };
}

function teamAnswer<T>(result: Result<T, TeamAccountRefusal>): T {
  if (result.ok) {
    return result.value;
  }
  switch (result.error.kind) {
    case 'InvalidRequest':
      throw new BadRequestException();
    case 'PhoneAlreadyUsed':
      throw new ConflictException(result.error);
    case 'AccountNotFound':
      throw new NotFoundException();
    case 'OnlyCollaboratorsGetProvisionalPins':
      throw new ForbiddenException(result.error);
  }
}

function answer(result: Result<void, AccountAccessRefusal>): void {
  if (result.ok) {
    return;
  }
  switch (result.error.kind) {
    case 'AccountNotFound':
      throw new NotFoundException();
    case 'CannotBlockOwnAccount':
      throw new ConflictException(result.error);
    case 'OnlyCollaboratorsCanBeBlocked':
      throw new ForbiddenException(result.error);
  }
}
