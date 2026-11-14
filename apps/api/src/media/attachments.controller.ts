import { BadRequestException, Body, Controller, HttpStatus, Inject, Post, Res } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import type { Clock } from '@kit';
import type { AttachRequest } from '@contracts';
import { CLOCK } from '../auth/clock.token';
import { CurrentSession, Roles, type Session } from '../auth/session';
import { PrismaService } from '../database/prisma.service';
import { attach } from './attachments';
import { isCanonicalUuid } from '@domain/journal';

const SHA256 = /^[0-9a-f]{64}$/;

// The supporting photos of the office (R.6). Admin only: money is in it.
@Roles('admin')
@Controller('attachments')
export class AttachmentsController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** 201 when joined, 200 when it already was: sent twice, kept once. */
  @Post()
  async join(@CurrentSession() session: Session, @Body() body: unknown, @Res() response: ServerResponse): Promise<void> {
    const request = requestOf(body);
    const result = await this.prisma.runInTenant(session.tenantId, (tx) => attach(tx, session, request, this.clock.now()));
    if (!result.ok) throw new BadRequestException(result.error);
    response.writeHead(result.value === 'Attached' ? HttpStatus.CREATED : HttpStatus.OK).end();
  }
}

// Whitelist at the border: exactly these four fields, each of its form.
function requestOf(body: unknown): AttachRequest {
  const values = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  const valid =
    values !== null &&
    Object.keys(values).sort().join() === 'id,media,subjectId,subjectKind' &&
    typeof values['id'] === 'string' &&
    isCanonicalUuid(values['id']) &&
    (values['subjectKind'] === 'Order' || values['subjectKind'] === 'Payment') &&
    typeof values['subjectId'] === 'string' &&
    isCanonicalUuid(values['subjectId']) &&
    typeof values['media'] === 'string' &&
    SHA256.test(values['media']);
  if (!valid) throw new BadRequestException({ kind: 'InvalidRequest' });
  return values as unknown as AttachRequest;
}
