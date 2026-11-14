import { BadRequestException, Body, ConflictException, Controller, Get, Inject, NotFoundException, Param, Post, Res } from '@nestjs/common';
import { type Clock } from '@kit';
import type { RecordWeighingRequest, WeighingsView } from '@contracts';
import { CLOCK } from '../auth/clock.token';
import { CurrentSession, Roles, type Session } from '../auth/session';
import { PrismaService } from '../database/prisma.service';
import { AfterCommit, type AfterCommitTask } from '../database/after-commit';
import { SiteNotifications } from '../notifications/site-notifications';
import { campaignWeighings, requestWeighing } from './weighings';
import { writtenStatus } from '../http/written';

// Weighings at the office (T.2, T.5): the chef asks for one, and reads what waits for validation.
// The weighing and its validation are journal events: they go through POST /journal/events.
@Roles('admin')
@Controller()
export class WeighingsController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly notifications: SiteNotifications,
  ) {}

  /** 201 when written, 200 when the same request was already there. */
  @Post('weighing-requests')
  async request(@CurrentSession() session: Session, @Body() body: unknown, @Res({ passthrough: true }) response: { status(code: number): unknown }, @AfterCommit() later: (task: AfterCommitTask) => void): Promise<void> {
    const valid = typeof body === 'object' && body !== null && !Array.isArray(body) && Object.keys(body).sort().join() === 'campaignId,id,requestedFor' && Object.values(body).every((value) => typeof value === 'string');
    if (!valid) throw new BadRequestException({ kind: 'InvalidRequest' });
    const result = await this.prisma.runInTenant(session.tenantId, (tx) => requestWeighing(tx, session, body as RecordWeighingRequest, this.clock.now()));
    if (!result.ok) throw result.error.kind === 'WeighingRequestAlreadyExists' ? new ConflictException(result.error) : new BadRequestException(result.error);
    response.status(writtenStatus(result.value));
    // A new request tells the caretakers of the site, once committed; the same one sent again does not (Y.2a).
    const id = (body as RecordWeighingRequest).id;
    if (result.value === 'Recorded') later(() => this.notifications.weighingRequested(session.tenantId, id));
  }

  @Get('campaigns/:id/weighings')
  async weighings(@CurrentSession() session: Session, @Param('id') id: string): Promise<WeighingsView> {
    const view = await this.prisma.runInTenant(session.tenantId, (tx) => campaignWeighings(tx, session.tenantId, id));
    if (view === null) throw new NotFoundException();
    return view;
  }
}
