import { describe, expect, it } from 'vitest';
import { grouped, typedNumber } from './typed-number';

// Spec: backlog Q.10 (demande du fondateur du 2026-11-13) — un montant se lit en le tapant :
// « 10 000 » et non « 10000 » ; le serveur reçoit toujours un entier.

describe('Un nombre tapé au bureau', () => {
  it('s’affiche avec l’espace des milliers', () => {
    expect(grouped('10000')).toBe('10 000');
    expect(grouped('1365000')).toBe('1 365 000');
    expect(grouped('950')).toBe('950');
    expect(grouped(2500)).toBe('2 500');
  });

  it('une case vide reste vide, jamais « 0 »', () => {
    expect(grouped('')).toBe('');
  });

  it('ce qui n’est pas un nombre entier reste tel que tapé : l’écran le refuse plus loin, sans le corriger en silence', () => {
    expect(grouped('1,5')).toBe('1,5');
    expect(grouped('12a')).toBe('12a');
  });

  it('se lit sans ses espaces, qu’elles soient tapées ou ajoutées par l’écran', () => {
    const typed = (value: string) => typedNumber({ target: { value } } as unknown as Event);
    expect(typed('10 000')).toBe('10000');
    expect(typed('1 365 000')).toBe('1365000');
    expect(typed(' 25 ')).toBe('25');
    expect(typed('1,5')).toBe('1,5');
  });
});
