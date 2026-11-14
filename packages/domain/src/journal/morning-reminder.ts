import { addDays, businessDayAt, type BusinessDay, type TimeZone } from './business-day';

/** The morning reminder leaves at 07:00, the site's time (Y.3; founder's decisions of 2026-11-14). */
export const MORNING_REMINDER_HOUR = 7;

/**
 * The day whose deaths the morning reminder asks for — yesterday, the site's day — from 07:00 in
 * its time zone; `null` before. The zero is declared for yesterday only (« Rien perdu hier »):
 * an evening reminder would ask for what cannot be answered yet. Whether that day was declared
 * is read apart: the zero counts (rule 10).
 */
export const morningReminderDay = (now: Date, timeZone: TimeZone): BusinessDay | null => {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', hourCycle: 'h23', numberingSystem: 'latn' }).format(now));
  return hour >= MORNING_REMINDER_HOUR ? addDays(businessDayAt(now, timeZone), -1) : null;
};
