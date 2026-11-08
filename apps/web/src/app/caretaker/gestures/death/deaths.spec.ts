import { clip, compose, counted, number } from '../../../core/audio/phrase';
import { confirmationOf } from './deaths';

// Spec: backlog K.1 — la voix relit la déclaration avant le Oui, et rappelle ce qui est déjà
// écrit ; CdC « Garde-fous anti-doublon » (la somme seule, décision du 2026-11-08) ;
// audio/script.md §3.

describe('La relecture des morts avant le Oui', () => {
  it("rien d'écrit ce jour-là : « 3 poulets morts aujourd'hui. C'est bien ça ? »", () => {
    const confirmation = confirmationOf(3, 'today', null);

    expect(confirmation.phrase).toEqual([counted('deaths-today', 3, 'deaths-many'), clip('confirm')]);
    expect(confirmation.words).toBe("3 poulets morts aujourd'hui ?");
    expect(confirmation.already).toBeNull();
  });

  it('pour hier et avant-hier, la phrase dit le jour', () => {
    expect(confirmationOf(1, 'yesterday', null).phrase[0]).toEqual(counted('deaths-yesterday', 1, 'deaths-many'));
    expect(confirmationOf(1, 'yesterday', null).words).toBe('1 poulet mort hier ?');
    expect(confirmationOf(2, 'dayBeforeYesterday', null).phrase[0]).toEqual(counted('deaths-before-yesterday', 2, 'deaths-many'));
  });

  it('des morts déjà écrits ce jour-là : la somme seule, puis « tes morts, c’est en plus ? » à la place de « c’est bien ça ? »', () => {
    const confirmation = confirmationOf(2, 'today', 5);

    expect(confirmation.phrase).toEqual([counted('deaths-today', 2, 'deaths-many'), counted('already-written', 5, 'already-written-many'), counted('deaths-in-addition', 2)]);
    expect(confirmation.already).toBe('Il y a déjà 5 morts écrits pour ce jour. Tes 2 morts, c’est en plus ?');
    expect(confirmationOf(1, 'today', 1).already).toBe('Il y a déjà 1 mort écrit pour ce jour. Ton mort, c’est en plus ?');
  });

  it('au-delà de vingt, les phrases se composent, le nombre à la fin, sans le redire dans « c’est en plus ? »', () => {
    const recorded = new Set(['deaths-many', 'already-written-many', 'deaths-in-addition-many', 'number-40', 'number-2', 'number-20', 'number-and', 'number-1']);

    expect(compose(confirmationOf(42, 'today', 21).phrase, 'fr', recorded)).toEqual({
      ok: true,
      value: ['deaths-many', 'number-40', 'number-2', 'already-written-many', 'number-20', 'number-and', 'number-1', 'deaths-in-addition-many'],
    });
    expect(confirmationOf(42, 'today', 21).phrase.at(-1)).toEqual(clip('deaths-in-addition-many'));
    expect(confirmationOf(42, 'today', 21).phrase).not.toContainEqual(number(42));
  });
});
