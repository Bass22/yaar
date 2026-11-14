import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import type { DeathPhotosView } from '@contracts';
import { CurrentSession, Roles, type Session } from '../auth/session';
import { PrismaService } from '../database/prisma.service';
import { deathPhotos } from './death-photos';

// The office reads, for a flock, how each caretaker answered for the dead (K.6). Admin only.
@Roles('admin')
@Controller()
export class DeathPhotosController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('campaigns/:id/death-photos')
  async read(@CurrentSession() session: Session, @Param('id') id: string): Promise<DeathPhotosView> {
    const view = await this.prisma.runInTenant(session.tenantId, (tx) => deathPhotos(tx, session.tenantId, id));
    if (view === null) throw new NotFoundException();
    return view;
  }
}
