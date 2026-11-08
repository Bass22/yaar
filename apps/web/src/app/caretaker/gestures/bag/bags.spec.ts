import { clip, compose, counted, number } from '../../../core/audio/phrase';
import { bagConfirmationOf } from './bags';

// Spec: backlog K.2 — déclarer un sac ouvert ; K.3 et CdC « Garde-fous anti-doublon » — le même
// rappel que pour les morts, la somme seule ; audio/script.md §4.

describe('La relecture des sacs ouverts avant le Oui', () => {
  it("« 2 sacs ouverts aujourd'hui. C'est bien ça ? », dit et écrit", () => {
    const confirmation = bagConfirmationOf(2, 'today', null);

    expect(confirmation.phrase).toEqual([counted('bags-today', 2, 'bags-many'), clip('confirm')]);
    expect(confirmation.words).toBe("2 sacs ouverts aujourd'hui ?");
    expect(confirmation.already).toBeNull();
  });

  it('pour hier et avant-hier, la phrase dit le jour', () => {
    expect(bagConfirmationOf(1, 'yesterday', null).phrase[0]).toEqual(counted('bags-yesterday', 1, 'bags-many'));
    expect(bagConfirmationOf(1, 'yesterday', null).words).toBe('1 sac ouvert hier ?');
    expect(bagConfirmationOf(3, 'dayBeforeYesterday', null).phrase[0]).toEqual(counted('bags-before-yesterday', 3, 'bags-many'));
    expect(bagConfirmationOf(3, 'dayBeforeYesterday', null).words).toBe('3 sacs ouverts avant-hier ?');
  });

  it('au-delà de vingt, la phrase se compose : « Sacs ouverts : vingt et un. C’est bien ça ? »', () => {
    const recorded = new Set(['bags-many', 'number-20', 'number-and', 'number-1', 'confirm']);

    expect(compose(bagConfirmationOf(21, 'today', null).phrase, 'fr', recorded)).toEqual({ ok: true, value: ['bags-many', 'number-20', 'number-and', 'number-1', 'confirm'] });
  });

  it('des sacs déjà écrits ce jour-là : la somme seule, puis « tes sacs, c’est en plus ? » à la place de « c’est bien ça ? »', () => {
    const confirmation = bagConfirmationOf(2, 'today', 3);

    expect(confirmation.phrase).toEqual([counted('bags-today', 2, 'bags-many'), counted('bags-already-written', 3, 'bags-already-written-many'), counted('bags-in-addition', 2)]);
    expect(confirmation.already).toBe('Il y a déjà 3 sacs ouverts écrits pour ce jour. Tes 2 sacs, c’est en plus ?');
    expect(bagConfirmationOf(1, 'today', 1).already).toBe('Il y a déjà 1 sac ouvert écrit pour ce jour. Ton sac, c’est en plus ?');
  });

  it('au-delà de vingt, le rappel se compose, sans redire le nombre dans « c’est en plus ? »', () => {
    const recorded = new Set(['bags-many', 'bags-already-written-many', 'bags-in-addition-many', 'number-20', 'number-and', 'number-1', 'number-2']);

    expect(compose(bagConfirmationOf(21, 'today', 22).phrase, 'fr', recorded)).toEqual({
      ok: true,
      value: ['bags-many', 'number-20', 'number-and', 'number-1', 'bags-already-written-many', 'number-20', 'number-2', 'bags-in-addition-many'],
    });
    expect(bagConfirmationOf(21, 'today', 22).phrase).not.toContainEqual(number(21));
  });
});
