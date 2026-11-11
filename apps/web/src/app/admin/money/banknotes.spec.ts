import { banknotesOf } from './banknotes';

// Spec: backlog P.4 — le montant se pose en billets pendant la frappe (bureau-admin-v2.html, écran 8) :
// des billets de 10 000, 5 000, 2 000, 1 000 et 500, le reste en pièces ; au-delà de 100 000 F,
// l'argent se compte en liasses de dix billets de 10 000, comme dans la main ; au-delà de neuf
// liasses, une liasse et son nombre.

describe('Le montant en billets', () => {
  it('42 000 F : quatre billets de 10 000 et un de 2 000', () => {
    expect(banknotesOf(42_000)).toEqual({ bundles: 0, notes: [{ value: 10_000, count: 4 }, { value: 2_000, count: 1 }], coins: 0 });
  });

  it('12 750 F : un billet de 10 000, un de 2 000, un de 500, et 250 F en pièces', () => {
    expect(banknotesOf(12_750)).toEqual({ bundles: 0, notes: [{ value: 10_000, count: 1 }, { value: 2_000, count: 1 }, { value: 500, count: 1 }], coins: 250 });
  });

  it('450 000 F : quatre liasses de 100 000 et cinq billets de 10 000', () => {
    expect(banknotesOf(450_000)).toEqual({ bundles: 4, notes: [{ value: 10_000, count: 5 }], coins: 0 });
  });

  it('100 000 F pile : une liasse ; 99 000 F : neuf billets de 10 000, un de 5 000, deux de 2 000', () => {
    expect(banknotesOf(100_000)).toEqual({ bundles: 1, notes: [], coins: 0 });
    expect(banknotesOf(99_000)).toEqual({ bundles: 0, notes: [{ value: 10_000, count: 9 }, { value: 5_000, count: 1 }, { value: 2_000, count: 2 }], coins: 0 });
  });

  it('rien, ou un montant qui n’est pas un entier positif : aucun billet', () => {
    expect([banknotesOf(0), banknotesOf(-5), banknotesOf(Number.NaN), banknotesOf(12.5)]).toEqual([
      { bundles: 0, notes: [], coins: 0 },
      { bundles: 0, notes: [], coins: 0 },
      { bundles: 0, notes: [], coins: 0 },
      { bundles: 0, notes: [], coins: 0 },
    ]);
  });
});
