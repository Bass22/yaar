import { clip, compose, counted } from '../../../core/audio/phrase';
import { bagConfirmationOf } from './bags';

// Spec: backlog K.2 — déclarer un sac ouvert ; audio/script.md §4. Le rappel de ce qui est déjà
// écrit pour les sacs viendra avec K.3.

describe('La relecture des sacs ouverts avant le Oui', () => {
  it("« 2 sacs ouverts aujourd'hui. C'est bien ça ? », dit et écrit", () => {
    const confirmation = bagConfirmationOf(2, 'today');

    expect(confirmation.phrase).toEqual([counted('bags-today', 2, 'bags-many'), clip('confirm')]);
    expect(confirmation.words).toBe("2 sacs ouverts aujourd'hui ?");
    expect(confirmation.already).toBeNull();
  });

  it('pour hier et avant-hier, la phrase dit le jour', () => {
    expect(bagConfirmationOf(1, 'yesterday').phrase[0]).toEqual(counted('bags-yesterday', 1, 'bags-many'));
    expect(bagConfirmationOf(1, 'yesterday').words).toBe('1 sac ouvert hier ?');
    expect(bagConfirmationOf(3, 'dayBeforeYesterday').phrase[0]).toEqual(counted('bags-before-yesterday', 3, 'bags-many'));
    expect(bagConfirmationOf(3, 'dayBeforeYesterday').words).toBe('3 sacs ouverts avant-hier ?');
  });

  it('au-delà de vingt, la phrase se compose : « Sacs ouverts : vingt et un. C’est bien ça ? »', () => {
    const recorded = new Set(['bags-many', 'number-20', 'number-and', 'number-1', 'confirm']);

    expect(compose(bagConfirmationOf(21, 'today').phrase, 'fr', recorded)).toEqual({ ok: true, value: ['bags-many', 'number-20', 'number-and', 'number-1', 'confirm'] });
  });
});
