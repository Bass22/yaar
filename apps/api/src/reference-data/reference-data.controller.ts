import { Controller, Get } from '@nestjs/common';
import type { ReferenceData } from '@contracts';
import { COST_CATEGORIES } from '@domain/finance';
import { LOSS_TYPES } from '@domain/journal';
import { Roles } from '../auth/session';

// The publisher's base (N.1): written in the domain, the same for every farm from its creation,
// so nothing is read from the database and no route can delete it. Office only: the caretaker
// never sees reference data, and cost categories are about money.
@Roles('admin')
@Controller('reference-data')
export class ReferenceDataController {
  @Get()
  read(): ReferenceData {
    return {
      costCategories: COST_CATEGORIES.map(({ category, behaviour, orderable }) => ({ category, behaviour, orderable })),
      lossTypes: ['Death', ...LOSS_TYPES],
    };
  }
}
