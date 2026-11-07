import { Controller, Get, Inject } from '@nestjs/common';
import type { Clock } from '@kit';
import type { CaretakerContext } from '@contracts';
import { CLOCK } from '../auth/clock.token';
import { CurrentSession, type Session } from '../auth/session';
import { PrismaService } from '../database/prisma.service';
import { caretakerContext } from './caretaker-context';

// The caretaker's notebook as it comes down to the phone (F.3). Any session: the sites are
// those the session reaches, filtered in the query, never on the screen.
@Controller('caretaker')
export class CaretakerController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Get('context')
  async context(@CurrentSession() session: Session): Promise<CaretakerContext> {
    return this.prisma.runInTenant(session.tenantId, (tx) => caretakerContext(tx, session, this.clock.now()));
  }
}
