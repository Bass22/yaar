import { Money, SignedMoney, unwrap, type CurrencyCode } from '@kit';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { recordLeftovers, type Leftover, type LeftoverInput, type LiveCount } from '../journal';
import { NOTE_MAX_LENGTH } from './cost';
import { closingReport, leftoverValues, transferLeftovers, type ClosingInput, type LeftoverValue, type ReceivedStock, type TransferContext } from './closing-report';

// Spec: backlog X.1 — les restes et le bilan ; cahier des charges « Les restes et le bilan »
// (décisions du fondateur du 2026-11-12 : valeur au prix moyen payé dans la bande, transférée à la
// bande que l'admin choisit ; coût par poulet et prix de vente moyen sur les poussins reçus ;
// bénéfice = chiffre d'affaires − coût net) ; CLAUDE.md §4 règles 7 (pas de flottant), 8 et 9.

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const XOF = 'XOF' as CurrencyCode;
const F = (amount: number): Money => unwrap(Money.of(amount, XOF));
const S = (amount: number): SignedMoney => unwrap(SignedMoney.of(amount, XOF));
const DEMARRAGE = uuid(31);
const LITIERE = uuid(32);
const VACCIN = uuid(33);
const NORD = uuid(3);
const SUD = uuid(5);
const BANDE = uuid(4);
const SUIVANTE = uuid(6);

const restes = (...inputs: LeftoverInput[]): readonly Leftover[] => unwrap(recordLeftovers(inputs));
// Une ligne reçue compte deux demis par sac ou par unité.
const recu = (costTypeId: string, received: number, billable: number): ReceivedStock => ({ costTypeId, halves: received * 2, value: F(billable) });

// Le jeu d'essai : 20 sacs de démarrage à 15 000 F et 10 à 16 000 F, 10 flacons de vaccin à 12 500 F.
const STOCK: readonly ReceivedStock[] = [recu(DEMARRAGE, 20, 300_000), recu(DEMARRAGE, 10, 160_000), recu(VACCIN, 10, 125_000)];
const RESTES = restes(
  { costTypeId: DEMARRAGE, category: 'Feed', whole: 3, opened: true },
  { costTypeId: VACCIN, category: 'Health', whole: 2 },
  { costTypeId: LITIERE, category: 'Bedding', whole: 1 },
);

describe('La valeur des restes', () => {
  it('au prix moyen payé dans la bande : 3 sacs et demi de démarrage, 2 flacons ; la litière jamais reçue n’a pas de valeur connue', () => {
    const valeurs = leftoverValues(RESTES, STOCK, XOF);

    // Démarrage : 460 000 F pour 30 sacs = 60 demis ; 7 demis → 460 000 × 7 ÷ 60 = 53 666,67 → 53 667 F
    // Vaccin : 125 000 F pour 10 flacons = 20 demis ; 4 demis → 25 000 F
    // Litière : rien reçu de ce type dans la bande → inconnue, jamais zéro
    expect(valeurs).toEqual([
      { costTypeId: DEMARRAGE, halves: 7, value: F(53_667) },
      { costTypeId: VACCIN, halves: 4, value: F(25_000) },
      { costTypeId: LITIERE, halves: 2, value: null },
    ]);
  });

  it('des restes reçus d’une bande précédente comptent à leur valeur dans le prix moyen', () => {
    // 4 sacs de démarrage hérités pour 56 000 F (8 demis) + 30 sacs pour 460 000 F (60 demis)
    const herite: ReceivedStock = { costTypeId: DEMARRAGE, halves: 8, value: F(56_000) };
    const [demarrage] = leftoverValues(RESTES, [...STOCK, herite], XOF);

    // 516 000 × 7 ÷ 68 = 53 117,65 → 53 118 F
    expect(demarrage?.value).toEqual(F(53_118));
  });

  it('un seul arrondi, à la fin, au franc le plus proche', () => {
    // 100 F pour 3 sacs ; un demi-sac → 100 × 1 ÷ 6 = 16,67 → 17 F
    const [valeur] = leftoverValues(restes({ costTypeId: DEMARRAGE, category: 'Feed', whole: 0, opened: true }), [recu(DEMARRAGE, 3, 100)], XOF);

    expect(valeur?.value).toEqual(F(17));
  });

  it('l’ordre des lignes reçues ne change rien à la valeur', () => {
    fc.assert(
      fc.property(fc.shuffledSubarray([...STOCK], { minLength: STOCK.length }), (melange) => {
        expect(leftoverValues(RESTES, melange, XOF)).toEqual(leftoverValues(RESTES, STOCK, XOF));
      }),
    );
  });

  it('un reste qui ne dépasse pas le reçu ne vaut jamais plus que ce qu’il a coûté', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 500 }), fc.integer({ min: 0, max: 10_000_000 }), fc.nat(), fc.boolean(), (sacs, prix, entiers, demi) => {
        const whole = entiers % (sacs + 1);
        if (whole === sacs && demi) return;
        if (whole === 0 && !demi) return;
        const [valeur] = leftoverValues(restes({ costTypeId: DEMARRAGE, category: 'Feed', whole, opened: demi }), [recu(DEMARRAGE, sacs, prix)], XOF);
        expect(valeur?.value?.amount).toBeLessThanOrEqual(prix);
      }),
    );
  });
});

describe('Le transfert des restes vers une autre bande', () => {
  const vers = (fields: Partial<TransferContext> = {}): TransferContext => ({ from: { campaignId: BANDE, siteId: NORD }, to: { campaignId: SUIVANTE, siteId: NORD, closed: false }, ...fields });

  it('la valeur connue sort de la bande close et entre, la même au franc près, dans la bande choisie', () => {
    const transfert = transferLeftovers(leftoverValues(RESTES, STOCK, XOF), vers(), XOF);

    // 53 667 + 25 000 = 78 667 F ; la litière passe sans argent
    expect(transfert.ok && transfert.value).toEqual({
      from: BANDE,
      to: SUIVANTE,
      leftovers: leftoverValues(RESTES, STOCK, XOF),
      value: F(78_667),
    });
  });

  it('l’argent se conserve : ce qui sort vaut la somme des valeurs connues', () => {
    fc.assert(
      fc.property(fc.array(fc.option(fc.integer({ min: 0, max: 50_000_000 }), { nil: null }), { maxLength: 12 }), (montants) => {
        const valeurs: LeftoverValue[] = montants.map((montant, rang) => ({ costTypeId: uuid(100 + rang), halves: 2, value: montant === null ? null : F(montant) }));
        const transfert = transferLeftovers(valeurs, vers(), XOF);
        expect(transfert.ok && transfert.value.value.amount).toBe(montants.reduce<number>((total, montant) => total + (montant ?? 0), 0));
      }),
    );
  });

  it('la bande qui reçoit est une autre bande du même site, pas close', () => {
    const valeurs = leftoverValues(RESTES, STOCK, XOF);

    const elleMeme = transferLeftovers(valeurs, vers({ to: { campaignId: BANDE, siteId: NORD, closed: false } }), XOF);
    const autreSite = transferLeftovers(valeurs, vers({ to: { campaignId: SUIVANTE, siteId: SUD, closed: false } }), XOF);
    const close = transferLeftovers(valeurs, vers({ to: { campaignId: SUIVANTE, siteId: NORD, closed: true } }), XOF);

    expect(elleMeme.ok ? null : elleMeme.error).toEqual({ kind: 'SameCampaign' });
    expect(autreSite.ok ? null : autreSite.error).toEqual({ kind: 'OtherSite' });
    expect(close.ok ? null : close.error).toEqual({ kind: 'DestinationClosed' });
  });

  it('une bande qui n’est pas un identifiant est refusée', () => {
    const transfert = transferLeftovers([], vers({ to: { campaignId: 'suivante', siteId: NORD, closed: false } }), XOF);

    expect(transfert.ok ? null : transfert.error).toEqual({ kind: 'InvalidId' });
  });
});

describe('Le bilan de la bande', () => {
  // 1 000 poussins reçus, 62 morts, 10 manquants, 900 vendus à 2 500 F (2 250 000 F), 2 000 000 F encaissés ;
  // engagé 2 100 000 F ; restes transférés 78 667 F.
  const COMPTE: LiveCount = { received: 1000, deaths: 62, losses: 10, sold: 900, liveCount: 28 };
  const bilan = (fields: Partial<ClosingInput> = {}): ClosingInput => ({
    count: COMPTE,
    committed: F(2_100_000),
    transferred: F(78_667),
    sales: { birdsSold: 900, revenue: F(2_250_000), cashedIn: F(2_000_000) },
    comment: 'Bonne bande, chaleur de la semaine 4.',
    ...fields,
  });

  it('poussins, pertes, coûts, revenus, coût par poulet sur les reçus, prix de vente par poussin reçu, bénéfice', () => {
    const rapport = closingReport(bilan());

    expect(rapport.ok && rapport.value).toEqual({
      chicksReceived: 1000,
      deaths: 62,
      losses: 10,
      birdsSold: 900,
      costs: F(2_100_000),
      leftovers: F(78_667),
      // 2 100 000 − 78 667 = 2 021 333 F
      netCost: S(2_021_333),
      revenue: F(2_250_000),
      cashedIn: F(2_000_000),
      // 2 021 333 ÷ 1 000 = 2 021,333 → 2 021 F
      costPerBird: S(2_021),
      // 2 250 000 ÷ 1 000 = 2 250 F, face aux 2 021 F du coût
      revenuePerChick: F(2_250),
      // 2 250 000 − 2 021 333 = 228 667 F
      profit: S(228_667),
      comment: 'Bonne bande, chaleur de la semaine 4.',
    });
  });

  it('une bande qui perd : le bénéfice est négatif, jamais bridé', () => {
    const rapport = closingReport(bilan({ sales: { birdsSold: 500, revenue: F(1_000_000), cashedIn: F(0) } }));

    // 1 000 000 − 2 021 333 = −1 021 333 F
    expect(rapport.ok && rapport.value.profit).toEqual(S(-1_021_333));
  });

  it('sans poussin reçu, le coût par poulet et le prix par poussin sont absents, jamais zéro', () => {
    const rapport = closingReport(bilan({ count: { received: 0, deaths: 0, losses: 0, sold: 0, liveCount: 0 }, sales: { birdsSold: 0, revenue: F(0), cashedIn: F(0) } }));

    expect(rapport.ok && rapport.value.costPerBird).toBeNull();
    expect(rapport.ok && rapport.value.revenuePerChick).toBeNull();
  });

  it('le prix par poussin s’arrondit au franc le plus proche', () => {
    // 2 250 600 ÷ 1 000 = 2 250,6 → 2 251 F
    const rapport = closingReport(bilan({ sales: { birdsSold: 900, revenue: F(2_250_600), cashedIn: F(0) } }));

    expect(rapport.ok && rapport.value.revenuePerChick).toEqual(F(2_251));
  });

  it('le commentaire est libre, jamais tronqué ; vide, il n’y a pas de commentaire', () => {
    const long = 'é'.repeat(NOTE_MAX_LENGTH);
    // 2 000 caractères entourés d'espaces : les espaces tombent, le texte reste entier
    expect(unwrap(closingReport(bilan({ comment: `  ${long}  ` }))).comment).toBe(long);
    expect(unwrap(closingReport(bilan({ comment: '   ' }))).comment).toBeNull();
    expect(unwrap(closingReport(bilan({ comment: null }))).comment).toBeNull();
  });

  it('un commentaire trop long est refusé plutôt que coupé', () => {
    const rapport = closingReport(bilan({ comment: 'x'.repeat(NOTE_MAX_LENGTH + 1) }));

    expect(rapport.ok ? null : rapport.error).toEqual({ kind: 'CommentTooLong', max: NOTE_MAX_LENGTH });
  });

  it('se recalcule à l’identique depuis les mêmes écritures', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000 }), fc.integer({ min: 0, max: 900_000_000 }), fc.integer({ min: 0, max: 900_000_000 }), (recus, engage, ventes) => {
        const entree = bilan({ count: { ...COMPTE, received: recus }, committed: F(engage), transferred: F(0), sales: { birdsSold: 0, revenue: F(ventes), cashedIn: F(0) } });
        expect(closingReport(entree)).toEqual(closingReport({ ...entree }));
        const rapport = unwrap(closingReport(entree));
        // bénéfice = chiffre d'affaires − coût net, au franc près
        expect(rapport.profit.amount).toBe(ventes - engage);
      }),
    );
  });
});
