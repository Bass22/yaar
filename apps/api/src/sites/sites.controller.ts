import { BadRequestException, Body, Controller, Delete, ForbiddenException, HttpCode, HttpStatus, Inject, NotFoundException, Param, Put } from '@nestjs/common';
import type { Clock, Result } from '@kit';
import type { DesignatePrimaryCaretakerRequest, SiteStaffRefusal } from '@contracts';
import { CLOCK } from '../auth/clock.token';
import { CurrentSession, Roles, type Session } from '../auth/session';
import { PrismaService } from '../database/prisma.service';
import { assignToSite, designatePrimaryCaretaker, removeFromSite } from './site-staff';

// The staff of a site (E.7): who writes in its notebook. Admin only; every change runs in the
// tenant transaction of the request and leaves its trace.
@Roles('admin')
@Controller('sites')
export class SitesController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

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
