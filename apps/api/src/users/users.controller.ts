import { ConflictException, Controller, ForbiddenException, HttpCode, HttpStatus, Inject, NotFoundException, Param, Post } from '@nestjs/common';
import type { Clock, Result } from '@kit';
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
  ) {}

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
