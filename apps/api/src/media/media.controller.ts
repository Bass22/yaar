import { BadRequestException, Controller, Get, HttpException, HttpStatus, Inject, NotFoundException, Param, Put, Query, Req, Res } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Clock } from '@kit';
import { CLOCK } from '../auth/clock.token';
import { CurrentSession, Roles, type Session } from '../auth/session';
import { PrismaService } from '../database/prisma.service';
import { readMedia, RETENTION_CLASSES, storeMedia, type RetentionClass } from './media';
import { MEDIA_MAX_BYTES, MediaStore } from './media-store';

const SHA256 = /^[0-9a-f]{64}$/;

// The media of the farm (M.1, architecture §7): a photo or a paper, sent by its fingerprint and
// read back by the admin only. No route deletes one (rule 13).
@Controller('media')
export class MediaController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: MediaStore,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * The body is the file, raw and streamed. What does not depend on the bytes is refused before
   * they are read. Then the file, then its row: a refusal past that point leaves a harmless
   * file nothing cites, never a row without its file. 201 when new, 200 when already there.
   */
  @Put(':sha256')
  async upload(
    @CurrentSession() session: Session,
    @Param('sha256') sha256: string,
    @Query('retention') retention: string | undefined,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<void> {
    if (!SHA256.test(sha256) || !(RETENTION_CLASSES as readonly (string | undefined)[]).includes(retention)) {
      throw new BadRequestException({ kind: 'InvalidRequest' });
    }
    const declared = Number(request.headers['content-length']);
    if (Number.isFinite(declared) && declared > MEDIA_MAX_BYTES) {
      throw new HttpException({ kind: 'TooLarge' }, HttpStatus.PAYLOAD_TOO_LARGE);
    }
    // Outside the transaction: no connection is held while the body streams in.
    const stored = await this.store.write(session.tenantId, sha256, request);
    switch (stored.kind) {
      case 'TooLarge':
        throw new HttpException({ kind: 'TooLarge' }, HttpStatus.PAYLOAD_TOO_LARGE);
      case 'UnsupportedType':
        throw new HttpException({ kind: 'UnsupportedType' }, HttpStatus.UNSUPPORTED_MEDIA_TYPE);
      case 'FingerprintMismatch':
        throw new BadRequestException({ kind: 'FingerprintMismatch' });
    }
    const outcome = await this.prisma.runInTenant(session.tenantId, (tx) => storeMedia(tx, session, stored, retention as RetentionClass, this.clock.now()));
    response.statusCode = outcome === 'Stored' ? HttpStatus.CREATED : HttpStatus.OK;
  }

  /** The bytes, as an attachment that can never run in the application's origin, never cached. */
  @Roles('admin')
  @Get(':sha256')
  async content(@CurrentSession() session: Session, @Param('sha256') sha256: string, @Res() response: ServerResponse): Promise<void> {
    const media = SHA256.test(sha256) ? await this.prisma.runInTenant(session.tenantId, (tx) => readMedia(tx, session.tenantId, sha256)) : null;
    if (media === null || !(await this.store.exists(session.tenantId, sha256))) {
      throw new NotFoundException();
    }
    response.writeHead(HttpStatus.OK, {
      'Content-Type': media.contentType,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'",
      'Cache-Control': 'private, no-store',
      'Content-Disposition': 'attachment',
    });
    await new Promise<void>((resolve, reject) => {
      this.store.read(session.tenantId, sha256).on('error', reject).pipe(response).on('finish', resolve).on('error', reject);
    });
  }
}
