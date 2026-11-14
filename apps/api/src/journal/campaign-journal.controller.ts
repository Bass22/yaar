import { Controller, Get, Inject, NotFoundException, Param } from '@nestjs/common';
import { type Clock } from '@kit';
import type { CampaignJournalView } from '@contracts';
import { CLOCK } from '../auth/clock.token';
import { CurrentSession, Roles, type Session } from '../auth/session';
import { PrismaService } from '../database/prisma.service';
import { campaignJournal } from './campaign-journal';

// The journal of a campaign at the office (O.7). Admin only: the caretaker has his notebook.
@Roles('admin')
@Controller()
export class CampaignJournalController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Get('campaigns/:id/journal')
  async read(@CurrentSession() session: Session, @Param('id') id: string): Promise<CampaignJournalView> {
    const view = await this.prisma.runInTenant(session.tenantId, (tx) => campaignJournal(tx, session.tenantId, id, this.clock.now()));
    if (view === null) throw new NotFoundException();
    return view;
  }
}
