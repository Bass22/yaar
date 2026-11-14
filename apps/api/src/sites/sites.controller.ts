import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, HttpCode, HttpStatus, Inject, NotFoundException, Param, Patch, Post, Put } from '@nestjs/common';
import type { Clock, Result } from '@kit';
import type { ConfigureSiteRequest, CreateSiteRequest, DesignatePrimaryCaretakerRequest, SiteConfigRefusal, SiteStaffRefusal } from '@contracts';
import { isLanguage } from '../users/account-profile';
import { configureSite, createSite } from './site-config';
import { CLOCK } from '../auth/clock.token';
import { CurrentSession, Roles, type Session } from '../auth/session';
import { PrismaService } from '../database/prisma.service';
import { assignToSite, designatePrimaryCaretaker, removeFromSite } from './site-staff';
import { objectOf } from '../http/body';

// The sites of the farm (O.1) and their staff (E.7): created and configured, and who writes in
// their notebook. Admin only; every change runs in the tenant transaction of the request and
// leaves its trace.
@Roles('admin')
@Controller('sites')
export class SitesController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@CurrentSession() session: Session, @Body() body: unknown): Promise<void> {
    const request = createRequestOf(body);
    configAnswer(await this.prisma.runInTenant(session.tenantId, (tx) => createSite(tx, session, request, this.clock.now())));
  }

  @Patch(':siteId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async configure(@CurrentSession() session: Session, @Param('siteId') siteId: string, @Body() body: unknown): Promise<void> {
    const change = configureRequestOf(body);
    configAnswer(await this.prisma.runInTenant(session.tenantId, (tx) => configureSite(tx, session, siteId, change, this.clock.now())));
  }

  @Put(':siteId/staff/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async assign(@CurrentSession() session: Session, @Param('siteId') siteId: string, @Param('userId') userId: string): Promise<void> {
    answer(await this.prisma.runInTenant(session.tenantId, (tx) => assignToSite(tx, session, siteId, userId, this.clock.now())));
  }

  @Delete(':siteId/staff/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentSession() session: Session, @Param('siteId') siteId: string, @Param('userId') userId: string): Promise<void> {
    answer(await this.prisma.runInTenant(session.tenantId, (tx) => removeFromSite(tx, session, siteId, userId, this.clock.now())));
  }

  @Put(':siteId/primary-caretaker')
  @HttpCode(HttpStatus.NO_CONTENT)
  async designate(@CurrentSession() session: Session, @Param('siteId') siteId: string, @Body() body: unknown): Promise<void> {
    const { userId } = designateRequestOf(body);
    answer(await this.prisma.runInTenant(session.tenantId, (tx) => designatePrimaryCaretaker(tx, session, siteId, userId, this.clock.now())));
  }
}

// Whitelist at the border: id, name, time zone, and the voice if chosen — never a farm, never the strict mode.
function createRequestOf(body: unknown): CreateSiteRequest {
  const values = objectOf(body);
  const keys = Object.keys(values).filter((key) => key !== 'audioLanguage').sort();
  const required = ['id', 'name', 'timeZone'];
  if (keys.join() !== required.join() || required.some((field) => typeof values[field] !== 'string')) {
    throw new BadRequestException({ kind: 'InvalidRequest' });
  }
  const language = values['audioLanguage'];
  if (language !== undefined && !isLanguage(language)) {
    throw new BadRequestException({ kind: 'InvalidRequest' });
  }
  return { id: values['id'] as string, name: values['name'] as string, timeZone: values['timeZone'] as string, ...(language === undefined ? {} : { audioLanguage: language }) };
}

// At least one of name, voice (or null) and strict mode, each of its type; never the time zone, never a farm.
function configureRequestOf(body: unknown): ConfigureSiteRequest {
  const values = objectOf(body);
  const keys = Object.keys(values);
  const valid =
    keys.length > 0 &&
    keys.every((key) => key === 'name' || key === 'audioLanguage' || key === 'strictMode') &&
    (!('name' in values) || typeof values['name'] === 'string') &&
    (!('audioLanguage' in values) || values['audioLanguage'] === null || isLanguage(values['audioLanguage'])) &&
    (!('strictMode' in values) || typeof values['strictMode'] === 'boolean');
  if (!valid) {
    throw new BadRequestException({ kind: 'InvalidRequest' });
  }
  return values as ConfigureSiteRequest;
}

function configAnswer(result: Result<void, SiteConfigRefusal>): void {
  if (result.ok) {
    return;
  }
  switch (result.error.kind) {
    case 'InvalidRequest':
    case 'InvalidName':
    case 'InvalidTimeZone':
      throw new BadRequestException(result.error);
    case 'SiteAlreadyExists':
      throw new ConflictException(result.error);
    case 'SiteNotFound':
      throw new NotFoundException();
  }
}

// Whitelist at the border: exactly the user id — neither a role, nor a flag, nor a tenant.
function designateRequestOf(body: unknown): DesignatePrimaryCaretakerRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException();
  }
  const values = body as Record<string, unknown>;
  if (Object.keys(values).join() !== 'userId' || typeof values['userId'] !== 'string') {
    throw new BadRequestException();
  }
  return { userId: values['userId'] };
}

function answer(result: Result<void, SiteStaffRefusal>): void {
  if (result.ok) {
    return;
  }
  switch (result.error.kind) {
    case 'SiteNotFound':
    case 'AccountNotFound':
    case 'AssignmentNotFound':
      throw new NotFoundException();
    case 'OnlyCollaboratorsAreAssigned':
      throw new ForbiddenException(result.error);
  }
}
