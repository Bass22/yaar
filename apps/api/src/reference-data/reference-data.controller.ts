import { Controller, Get } from '@nestjs/common';
import type { ReferenceData } from '@contracts';
import { COST_CATEGORIES } from '@domain/finance';
import { LOSS_TYPES, STRAINS } from '@domain/journal';
import { CurrentSession, Roles, type Session } from '../auth/session';
import { PrismaService } from '../database/prisma.service';

// The publisher's base (N.1) and strains (N.4): written in the domain, the same for every farm from its creation,
// so none of it is read from the database (only the farm's currency is) and no route can delete it. Office only: the caretaker
// never sees reference data, and cost categories are about money.
@Roles('admin')
@Controller('reference-data')
export class ReferenceDataController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async read(@CurrentSession() session: Session): Promise<ReferenceData> {
    const tenant = await this.prisma.runInTenant(session.tenantId, (tx) => tx.tenant.findUniqueOrThrow({ where: { id: session.tenantId }, select: { currency: true } }));
    return {
      currency: tenant.currency,
      costCategories: COST_CATEGORIES.map(({ category, behaviour, orderable }) => ({ category, behaviour, orderable })),
      lossTypes: ['Death', ...LOSS_TYPES],
      strains: STRAINS.map(({ code, name, species }) => ({ strain: code, name, species })),
    };
  }
}
