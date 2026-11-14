import { describe, expect, it } from 'vitest';
import { unwrap } from '@kit';
import { TimeZone } from './business-day';
import { MORNING_REMINDER_HOUR, morningReminderDay } from './morning-reminder';

// Spec: backlog Y.3 — le rappel du matin (décisions du fondateur du 2026-11-14 : 7 h, heure du
// site, sur les morts d'hier — le zéro ne se déclare que pour hier).

const DAKAR = unwrap(TimeZone('Africa/Dakar'));
const PARIS = unwrap(TimeZone('Europe/Paris'));

describe('L’heure du rappel du matin', () => {
  it('à partir de 7 h, heure du site, le rappel vaut pour hier ; avant, rien', () => {
    expect(MORNING_REMINDER_HOUR).toBe(7);
    expect(morningReminderDay(new Date('2026-11-15T06:59:59.000Z'), DAKAR)).toBeNull();
    expect(morningReminderDay(new Date('2026-11-15T07:00:00.000Z'), DAKAR)).toBe('2026-11-14');
    expect(morningReminderDay(new Date('2026-11-15T23:59:59.000Z'), DAKAR)).toBe('2026-11-14');
  });

  it('chaque site a son heure : 7 h à Paris tombe à 6 h à Dakar en hiver', () => {
    const septHeuresAParis = new Date('2026-11-15T06:00:00.000Z');
    expect(morningReminderDay(septHeuresAParis, PARIS)).toBe('2026-11-14');
    expect(morningReminderDay(septHeuresAParis, DAKAR)).toBeNull();
  });
});
