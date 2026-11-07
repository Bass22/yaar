import { BadRequestException, Body, Controller, HttpCode, HttpStatus, PayloadTooLargeException, Post } from '@nestjs/common';
import type { JournalBatchResponse } from '@contracts';
import { CurrentSession, type Session } from '../auth/session';
import { PrismaService } from '../database/prisma.service';
import { ingestEvents } from './ingest-events';
import { PrismaJournal } from './prisma-journal';

/** The most events a phone sends in one request: its outbox goes out in several batches. */
export const MAX_EVENTS_PER_BATCH = 100;

// The journal a phone sends (Architecture §5). Any session: who may write what is the business
// of the domain, judged event by event with the author and the farm of the session.
@Controller('journal')
export class JournalController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('events')
  @HttpCode(HttpStatus.OK)
  async ingest(@CurrentSession() session: Session, @Body() body: unknown): Promise<JournalBatchResponse> {
    const events = eventsOf(body);
    const outcomes = await this.prisma.runInTenant(session.tenantId, (tx) => ingestEvents(events, session, new PrismaJournal(tx, session.tenantId)));
    return { outcomes };
  }
}

// Whitelist at the border: exactly `{ events: [...] }`. Each event is judged on its own.
function eventsOf(body: unknown): readonly unknown[] {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException();
  }
  const values = body as Record<string, unknown>;
  const events = values['events'];
  if (Object.keys(values).join() !== 'events' || !Array.isArray(events)) {
    throw new BadRequestException();
  }
  if (events.length > MAX_EVENTS_PER_BATCH) {
    throw new PayloadTooLargeException();
  }
  return events;
}
