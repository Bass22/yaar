import { Money, unwrap, type CurrencyCode } from '@kit';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { committedCost, costPerBird, effectiveCosts, EXPECTED_LOSS_RATE, recordCost, reviseCost, type CostContext, type CostEntry, type CostInput } from './cost';

// Spec: backlog P.1 — un coût et l'engagé à date ; P.2 — modifier un coût laisse une trace ;
// cahier des charges « Les dépenses » (décisions du 2026-11-12 : le coût par poulet = engagé ÷
// vivants d'aujourd'hui, arrondi au franc) ; CLAUDE.md §4 règles 2 (identifiant de l'appareil,
// jamais de modification : une contre-écriture), 7 (pas de flottant), 8 (projection) et 10.

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const XOF = 'XOF' as CurrencyCode;
const F = (amount: number): Money => unwrap(Money.of(amount, XOF));
const BANDE = uuid(4);
const SALAIRE = uuid(43);
const EAU = uuid(44);
const DEPLUMAGE = uuid(45);
const OUSMANE = uuid(61);
const SEDIMA = uuid(62);
const RAMASSEUR = uuid(63);
const ANCIEN = uuid(64);

const contexte: CostContext = {
  currency: XOF,
  today: '2026-11-12' as CostContext['today'],
  costTypes: [
    { id: SALAIRE, archived: false },
    { id: EAU, archived: false },
    { id: DEPLUMAGE, archived: true },
  ],
  counterparties: [
    { id: OUSMANE, kind: 'Collaborator', archived: false },
    { id: SEDIMA, kind: 'Supplier', archived: false },
    { id: RAMASSEUR, kind: 'Customer', archived: false },
    { id: ANCIEN, kind: 'Supplier', archived: true },
  ],
};

// The water bill of November 10th: 12 500 F, paid.
const unCout = (rank: number, fields: Partial<CostInput> = {}): CostInput => ({
  id: uuid(rank),
  campaignId: BANDE,
  costTypeId: EAU,
  spentOn: '2026-11-10',
  amount: 12_500,
  note: null,
  payment: { kind: 'Paid' },
  receipt: null,
  recordedAt: `2026-11-12T08:${String(rank % 60).padStart(2, '0')}:00.000Z`,
  ...fields,
});
const ecrit = (input: CostInput): CostEntry => unwrap(recordCost(input, contexte));

describe('Un coût', () => {
  it('porte un identifiant créé au bureau, un type, une date de dépense, un montant, une note et un statut payé ou à payer', () => {
    const cost = recordCost(unCout(1, { note: 'Facture SDE d’octobre, payée au guichet de Thiès' }), contexte);

    expect(cost).toEqual({
      ok: true,
      value: {
        id: uuid(1),
        corrects: null,
        campaignId: BANDE,
        costTypeId: EAU,
        spentOn: '2026-11-10',
        amount: F(12_500),
        note: 'Facture SDE d’octobre, payée au guichet de Thiès',
        payment: { kind: 'Paid' },
        receipt: null,
        recordedAt: '2026-11-12T08:01:00.000Z',
      },
    });
  });

  it('« à payer » nomme le tiers à qui l’élevage doit : un collaborateur (le salaire) ou un fournisseur', () => {
    expect(recordCost(unCout(2, { costTypeId: SALAIRE, amount: 45_000, payment: { kind: 'ToPay', counterpartyId: OUSMANE } }), contexte)).toMatchObject({ ok: true, value: { payment: { kind: 'ToPay', counterpartyId: OUSMANE } } });
    expect(recordCost(unCout(3, { payment: { kind: 'ToPay', counterpartyId: SEDIMA } }), contexte).ok).toBe(true);
  });

  it('la date de dépense peut être passée, jamais dans le futur', () => {
    expect(recordCost(unCout(4, { spentOn: '2026-09-01' }), contexte).ok).toBe(true);
    expect(recordCost(unCout(5, { spentOn: '2026-11-12' }), contexte).ok).toBe(true);
    expect(recordCost(unCout(6, { spentOn: '2026-11-13' }), contexte)).toEqual({ ok: false, error: { kind: 'SpentInFuture' } });
  });

  it('refuse un montant nul, négatif ou fractionnaire, un type inconnu ou archivé, un tiers inconnu, archivé ou client, une date ou un identifiant invalides', () => {
    const refus = [
      unCout(10, { amount: 0 }),
      unCout(11, { amount: -500 }),
      unCout(12, { amount: 99.5 }),
      unCout(13, { costTypeId: uuid(99) }),
      unCout(14, { costTypeId: DEPLUMAGE }),
      unCout(15, { payment: { kind: 'ToPay', counterpartyId: uuid(98) } }),
      unCout(16, { payment: { kind: 'ToPay', counterpartyId: ANCIEN } }),
      unCout(17, { payment: { kind: 'ToPay', counterpartyId: RAMASSEUR } }),
      unCout(18, { spentOn: 'hier' }),
      unCout(19, { id: 'c-1' }),
      unCout(20, { note: 'x'.repeat(2001) }),
      unCout(21, { receipt: 'pas-une-empreinte' }),
    ].map((input) => recordCost(input, contexte));

    expect(refus).toEqual([
      { ok: false, error: { kind: 'InvalidAmount' } },
      { ok: false, error: { kind: 'InvalidAmount' } },
      { ok: false, error: { kind: 'InvalidAmount' } },
      { ok: false, error: { kind: 'UnknownCostType' } },
      { ok: false, error: { kind: 'CostTypeArchived' } },
      { ok: false, error: { kind: 'UnknownCounterparty' } },
      { ok: false, error: { kind: 'CounterpartyArchived' } },
      { ok: false, error: { kind: 'NotACreditor' } },
      { ok: false, error: { kind: 'InvalidBusinessDay' } },
      { ok: false, error: { kind: 'InvalidId', expected: 'CostId' } },
      { ok: false, error: { kind: 'NoteTooLong' } },
      { ok: false, error: { kind: 'InvalidMediaFingerprint' } },
    ]);
  });

  it('une note vide ne s’écrit pas : elle est absente, pas une chaîne vide', () => {
    expect(ecrit(unCout(22, { note: '   ' })).note).toBeNull();
  });
});

describe('Modifier un coût laisse une trace', () => {
  const eau = ecrit(unCout(1));

  it('une contre-écriture remplace le coût entier : montant, date, note, statut ; l’original reste dans l’historique', () => {
    const corrige = unwrap(reviseCost(eau, unCout(30, { amount: 13_200, spentOn: '2026-11-09', note: 'Montant relu sur la facture' }), contexte));

    const [cost] = effectiveCosts([eau, corrige]);
    expect(cost?.current).toMatchObject({ id: uuid(30), corrects: uuid(1), amount: F(13_200), spentOn: '2026-11-09', note: 'Montant relu sur la facture' });
    expect(cost?.id).toBe(uuid(1));
    expect(cost?.history.map(({ id }) => id)).toEqual([uuid(1), uuid(30)]);
  });

  it('« à payer » → payé est une seule contre-écriture', () => {
    const salaire = ecrit(unCout(2, { costTypeId: SALAIRE, amount: 45_000, payment: { kind: 'ToPay', counterpartyId: OUSMANE } }));

    const paye = unwrap(reviseCost(salaire, unCout(31, { costTypeId: SALAIRE, amount: 45_000, payment: { kind: 'Paid' }, recordedAt: '2026-11-13T09:00:00.000Z' }), contexte));

    expect(effectiveCosts([salaire, paye])[0]?.current.payment).toEqual({ kind: 'Paid' });
  });

  it('une contre-écriture reçue deux fois ne compte qu’une fois : ni dans l’engagé, ni dans l’historique', () => {
    const corrige = unwrap(reviseCost(eau, unCout(38, { amount: 13_200 }), contexte));

    const [cost] = effectiveCosts([eau, corrige, corrige]);
    expect(cost?.history.map(({ id }) => id)).toEqual([uuid(1), uuid(38)]);
  });

  it('la dernière écrite fait foi, d’après sa date de saisie, quel que soit l’ordre d’arrivée', () => {
    const premiere = unwrap(reviseCost(eau, unCout(32, { amount: 13_000, recordedAt: '2026-11-12T09:00:00.000Z' }), contexte));
    const seconde = unwrap(reviseCost(eau, unCout(33, { amount: 13_200, recordedAt: '2026-11-12T10:00:00.000Z' }), contexte));

    expect(effectiveCosts([seconde, eau, premiere])[0]?.current.amount).toEqual(F(13_200));
  });

  it('une contre-écriture vise le coût d’origine, dans la même bande ; elle ne change pas de bande et suit les mêmes règles', () => {
    const corrige = unwrap(reviseCost(eau, unCout(34, { amount: 13_000 }), contexte));

    expect([
      reviseCost(corrige, unCout(35), contexte),
      reviseCost(eau, unCout(36, { campaignId: uuid(5) }), contexte),
      reviseCost(eau, unCout(37, { amount: 0 }), contexte),
      reviseCost(eau, unCout(1), contexte),
    ]).toEqual([
      { ok: false, error: { kind: 'CorrectsACorrection' } },
      { ok: false, error: { kind: 'CorrectionChangesCampaign' } },
      { ok: false, error: { kind: 'InvalidAmount' } },
      { ok: false, error: { kind: 'CorrectsItself' } },
    ]);
  });
});

describe("L'engagé et le coût par poulet", () => {
  it("l'engagé est la somme des coûts, payés comme à payer, et du facturable des commandes de la bande", () => {
    const eau = ecrit(unCout(1));
    const salaire = ecrit(unCout(2, { costTypeId: SALAIRE, amount: 45_000, payment: { kind: 'ToPay', counterpartyId: OUSMANE } }));

    // 12 500 + 45 000 + the order of 12/10 received: 900 000 = 957 500 F.
    expect(committedCost(effectiveCosts([eau, salaire]), [F(900_000)], XOF)).toEqual(F(957_500));
  });

  it("une correction compte pour sa dernière valeur, jamais deux fois", () => {
    const eau = ecrit(unCout(1));
    const corrige = unwrap(reviseCost(eau, unCout(30, { amount: 13_200 }), contexte));

    expect(committedCost(effectiveCosts([eau, corrige]), [], XOF)).toEqual(F(13_200));
  });

  it('le même coût reçu deux fois ne compte qu’une fois dans l’engagé, quel que soit l’ordre (propriété)', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 1_000_000 }), { minLength: 1, maxLength: 8 }), fc.integer({ min: 0, max: 5 }), (amounts, seed) => {
        const costs = amounts.map((amount, index) => ecrit(unCout(100 + index, { amount })));
        const withDuplicates = [...costs, ...costs.slice(0, seed % costs.length + 1)].reverse();
        return committedCost(effectiveCosts(withDuplicates), [], XOF).amount === amounts.reduce((sum, amount) => sum + amount, 0);
      }),
    );
  });

  it('sans rien, l’engagé vaut zéro franc', () => {
    expect(committedCost([], [], XOF)).toEqual(F(0));
  });

  it('le coût par poulet divise par les poulets qu’on attend de vendre : les poussins reçus moins 7 % de pertes prévues, au franc près', () => {
    // 1 000 received, 3 dead (0,3 %): 7 % expected → 930 birds; 957 500 ÷ 930 = 1 029,57… → 1 030 F.
    expect(EXPECTED_LOSS_RATE).toBe(0.07);
    expect(costPerBird(F(957_500), { received: 1000, liveCount: 997 })).toEqual(F(1030));
  });

  it('dès que les pertes réelles dépassent 7 %, on suit le réel : les vivants', () => {
    // 1 000 received, 900 alive (10 % lost): 957 500 ÷ 900 = 1 063,88… → 1 064 F.
    expect(costPerBird(F(957_500), { received: 1000, liveCount: 900 })).toEqual(F(1064));
    // 1 050 received (bonus): 7 % → 976,5 → 976 birds; 976 alive is the same.
    expect(costPerBird(F(976_000), { received: 1050, liveCount: 1000 })).toEqual(F(1000));
  });

  it('sans vivants connus, ou sans poulet à diviser, il est absent, jamais zéro', () => {
    expect([costPerBird(F(957_500), { received: 0, liveCount: null }), costPerBird(F(957_500), { received: 1000, liveCount: 0 }), costPerBird(F(957_500), { received: 1000, liveCount: -3 })]).toEqual([null, null, null]);
  });
});
