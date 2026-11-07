import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, HttpCode, HttpStatus, Inject, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import type { Clock, Result } from '@kit';
import type { CreateAccountRequest, ProvisionalPin, UpdateAccountRequest } from '@contracts';
import { isAvatar, isLanguage, updateAccount } from './account-profile';
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

  @Patch(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async update(@CurrentSession() session: Session, @Param('userId') userId: string, @Body() body: unknown): Promise<void> {
    const change = updateAccountRequestOf(body);
    const result = await this.prisma.runInTenant(session.tenantId, (tx) => updateAccount(tx, userId, change));
    if (!result.ok) {
      throw new NotFoundException();
    }
  }

  @Post(':userId/reset-pin')
  @HttpCode(HttpStatus.OK)
  async resetPin(@CurrentSession() session: Session, @Param('userId') userId: string): Promise<ProvisionalPin> {
    return teamAnswer(await this.prisma.runInTenant(session.tenantId, (tx) => resetPin(tx, this.hasher, session, userId, this.clock.now())));
  }

  @Post(':userId/block')
  @HttpCode(HttpStatus.NO_CONTENT)
  async block(@CurrentSession() session: Session, @Param('userId') userId: string): Promise<void> {
    answer(await this.prisma.runInTenant(session.tenantId, (tx) => blockAccount(tx, session, userId, this.clock.now())));
  }

  @Post(':userId/unblock')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unblock(@CurrentSession() session: Session, @Param('userId') userId: string): Promise<void> {
    answer(await this.prisma.runInTenant(session.tenantId, (tx) => unblockAccount(tx, session, userId, this.clock.now())));
  }

  @Post(':userId/sign-out-everywhere')
  @HttpCode(HttpStatus.NO_CONTENT)
  async signOutEverywhere(@CurrentSession() session: Session, @Param('userId') userId: string): Promise<void> {
    answer(await this.prisma.runInTenant(session.tenantId, (tx) => signOutEverywhere(tx, session, userId, this.clock.now())));
  }
}

// Whitelist at the border: id, phone, name and avatar, and the language if chosen — neither a
// role, nor a PIN, nor a tenant.
function createAccountRequestOf(body: unknown): CreateAccountRequest {
  const values = objectOf(body);
  const required = ['avatar', 'id', 'name', 'phone'];
  const keys = Object.keys(values).filter((key) => key !== 'language').sort();
  if (keys.join() !== required.join() || required.some((field) => typeof values[field] !== 'string')) {
    throw new BadRequestException();
  }
  const language = values['language'];
  if (language !== undefined && !isLanguage(language)) {
    throw new BadRequestException();
  }
  return { id: values['id'] as string, phone: values['phone'] as string, name: values['name'] as string, avatar: values['avatar'] as CreateAccountRequest['avatar'], ...(language === undefined ? {} : { language }) };
}

// Exactly the avatar, the language, or both; each from its closed list (a null language: follow the site).
function updateAccountRequestOf(body: unknown): UpdateAccountRequest {
  const values = objectOf(body);
  const keys = Object.keys(values);
  if (keys.length === 0 || keys.some((key) => key !== 'avatar' && key !== 'language')) {
    throw new BadRequestException();
  }
  if ('avatar' in values && !isAvatar(values['avatar'])) {
    throw new BadRequestException();
  }
  if ('language' in values && values['language'] !== null && !isLanguage(values['language'])) {
    throw new BadRequestException();
  }
  return values as UpdateAccountRequest;
}

function objectOf(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException();
  }
  return body as Record<string, unknown>;
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
