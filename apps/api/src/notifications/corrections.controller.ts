import { Controller, Get, HttpCode, HttpStatus, Inject, NotFoundException, Param, Post } from '@nestjs/common';
import type { Clock } from '@kit';
import type { CorrectionToReview } from '@contracts';
import { CLOCK } from '../auth/clock.token';
import { CurrentSession, Roles, type Session } from '../auth/session';
import { PrismaService } from '../database/prisma.service';
import { correctionsToReview, reviewCorrection } from './corrections';

// The corrections waiting for an admin's « Vu » (Y.2b). Admin only.
@Roles('admin')
@Controller('corrections')
export class CorrectionsController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Get('to-review')
  toReview(@CurrentSession() session: Session): Promise<CorrectionToReview[]> {
    return this.prisma.runInTenant(session.tenantId, (tx) => correctionsToReview(tx));
  }

  @Post(':id/review')
  @HttpCode(HttpStatus.NO_CONTENT)
  async review(@CurrentSession() session: Session, @Param('id') id: string): Promise<void> {
    const result = await this.prisma.runInTenant(session.tenantId, (tx) => reviewCorrection(tx, session, id, this.clock.now()));
    if (!result.ok) throw new NotFoundException(result.error);
  }
}
