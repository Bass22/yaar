import { InjectionToken } from '@angular/core';
import type { Clock } from '@kit';

/** The phone's clock, read by the application and handed to the field rules (CLAUDE.md §8): tests give their own. */
export const CLOCK = new InjectionToken<Clock>('CLOCK', { providedIn: 'root', factory: () => ({ now: () => new Date() }) });
