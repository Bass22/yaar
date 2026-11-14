import { Money, unwrap, type CurrencyCode } from '@kit';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { suggestedPrice, unusualPrice, type KnownPrice } from './price-catalog';

// Spec: backlog N.5 — le catalogue de prix apprend seul ; cahier des charges « Valeurs par défaut »
// (décisions du fondateur du 2026-11-13 : vide au départ, il apprend des commandes ; un prix par
// article et par fournisseur ; un prix fixé à la main compte comme payé à sa date).

const XOF = 'XOF' as CurrencyCode;
const F = (amount: number): Money => unwrap(Money.of(amount, XOF));
const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const DEMARRAGE = uuid(43);
const POUSSINS = uuid(42);
const SEDIMA = uuid(31);
const TOUBA = uuid(32);

const paye = (costTypeId: string, supplierId: string | null, price: number, at: string): KnownPrice => ({ costTypeId, supplierId, unitPrice: F(price), at });

describe('Le prix proposé', () => {
  it('le dernier prix payé à ce fournisseur pour cet article', () => {
    const prix = [paye(DEMARRAGE, SEDIMA, 17_000, '2026-09-01T08:00:00.000Z'), paye(DEMARRAGE, SEDIMA, 17_500, '2026-10-12T08:00:00.000Z'), paye(DEMARRAGE, TOUBA, 16_000, '2026-11-01T08:00:00.000Z')];

    expect(suggestedPrice(prix, DEMARRAGE, SEDIMA)).toEqual(F(17_500));
  });

  it('chez un fournisseur qui ne l’a jamais vendu : le dernier prix de l’article, chez n’importe qui', () => {
    const prix = [paye(DEMARRAGE, SEDIMA, 17_500, '2026-10-12T08:00:00.000Z'), paye(DEMARRAGE, TOUBA, 16_000, '2026-11-01T08:00:00.000Z')];

    expect(suggestedPrice(prix, DEMARRAGE, uuid(33))).toEqual(F(16_000));
  });

  it('sans fournisseur choisi encore : le dernier prix de l’article', () => {
    const prix = [paye(DEMARRAGE, SEDIMA, 17_500, '2026-10-12T08:00:00.000Z'), paye(DEMARRAGE, TOUBA, 16_000, '2026-11-01T08:00:00.000Z')];

    expect(suggestedPrice(prix, DEMARRAGE, null)).toEqual(F(16_000));
  });

  it('un article jamais payé : rien de proposé — la case reste vide, jamais 0', () => {
    expect(suggestedPrice([paye(DEMARRAGE, SEDIMA, 17_500, '2026-10-12T08:00:00.000Z')], POUSSINS, SEDIMA)).toBeNull();
    expect(suggestedPrice([], DEMARRAGE, SEDIMA)).toBeNull();
  });

  it('un prix fixé à la main pour tous les fournisseurs compte à sa date : il l’emporte sur un prix payé plus ancien, puis le prochain prix payé le remplace', () => {
    const fixe = paye(DEMARRAGE, null, 18_000, '2026-11-05T08:00:00.000Z');
    const avant = paye(DEMARRAGE, SEDIMA, 17_500, '2026-10-12T08:00:00.000Z');
    const apres = paye(DEMARRAGE, SEDIMA, 18_500, '2026-11-10T08:00:00.000Z');

    // Chez Sedima, le prix payé à Sedima l'emporte sur le prix pour tous, même plus récent ;
    // ailleurs, le prix pour tous est le dernier prix de l'article.
    expect(suggestedPrice([avant, fixe], DEMARRAGE, TOUBA)).toEqual(F(18_000));
    expect(suggestedPrice([avant, fixe, apres], DEMARRAGE, TOUBA)).toEqual(F(18_500));
  });

  it('un prix fixé à la main pour ce fournisseur l’emporte sur un prix payé plus ancien chez lui', () => {
    const prix = [paye(DEMARRAGE, SEDIMA, 17_500, '2026-10-12T08:00:00.000Z'), paye(DEMARRAGE, SEDIMA, 19_000, '2026-11-05T08:00:00.000Z')];

    expect(suggestedPrice(prix, DEMARRAGE, SEDIMA)).toEqual(F(19_000));
  });

  it('un prix nul a été payé ou fixé : il se propose (un don, un échantillon) — il n’est pas « pas de prix »', () => {
    expect(suggestedPrice([paye(DEMARRAGE, SEDIMA, 0, '2026-10-12T08:00:00.000Z')], DEMARRAGE, SEDIMA)).toEqual(F(0));
  });

  it('l’ordre de lecture ne change rien', () => {
    const prix = [paye(DEMARRAGE, SEDIMA, 17_000, '2026-09-01T08:00:00.000Z'), paye(DEMARRAGE, SEDIMA, 17_500, '2026-10-12T08:00:00.000Z'), paye(DEMARRAGE, TOUBA, 16_000, '2026-11-01T08:00:00.000Z'), paye(DEMARRAGE, null, 18_000, '2026-08-01T08:00:00.000Z')];
    fc.assert(
      fc.property(fc.shuffledSubarray(prix, { minLength: prix.length }), (melange) => {
        expect(suggestedPrice(melange, DEMARRAGE, SEDIMA)).toEqual(F(17_500));
        expect(suggestedPrice(melange, DEMARRAGE, uuid(33))).toEqual(F(16_000));
      }),
    );
  });
});

// Spec: backlog Q.13 — la relecture qui attrape les inversions (le fondateur a tapé 2 250 en quantité au lieu du prix)
describe('Un prix inhabituel', () => {
  it('trois fois moins, ou trois fois plus, que le prix connu de l’article : à relire', () => {
    // Le sac à 18 000 F d'habitude : 10 F, c'est une quantité et un prix inversés ; 60 000 F aussi, à relire
    expect([unusualPrice(F(10), F(18_000)), unusualPrice(F(60_000), F(18_000))]).toEqual([true, true]);
  });

  it('un prix qui bouge sans tripler n’est pas inhabituel : une hausse, une remise', () => {
    expect([unusualPrice(F(17_000), F(18_000)), unusualPrice(F(6_000), F(18_000)), unusualPrice(F(54_000), F(18_000))]).toEqual([false, false, false]);
  });

  it('sans prix connu, ou un prix connu nul (un don), rien ne se compare : jamais un avertissement', () => {
    expect([unusualPrice(F(10), null), unusualPrice(F(10), F(0))]).toEqual([false, false]);
  });
});

