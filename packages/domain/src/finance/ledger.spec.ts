import { Money, SignedMoney, unwrap, type CurrencyCode } from '@kit';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { recordCost, reviseCost, effectiveCosts, type CostContext, type CostInput } from './cost';
import { costEntries, ledgerOf, orderEntries, settlementEntries } from './ledger';
import { recordPayment } from './order-balance';
import { draftOrder, type PurchaseOrder } from './purchase-order';
import { recordSettlement, type SettlementContext, type SettlementInput } from './settlement';

// Spec: backlog R.1 — les soldes se déduisent des écritures ; R.2 — régler en une ou plusieurs
// fois ; cahier des charges « Le grand livre » (2026-11-12 : un règlement plus gros que la dette
// crée une créance) ; CLAUDE.md §4 règles 8 (aucun solde stocké) et 9 (signé, jamais bridé).

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const XOF = 'XOF' as CurrencyCode;
const signe = (amount: number): SignedMoney => unwrap(SignedMoney.of(amount, XOF));
const BANDE = uuid(4);
const SEDIMA = uuid(31);
const OUSMANE = uuid(32);
const RAMASSEUR = uuid(33);
const ALIMENT = uuid(41);
const SALAIRE = uuid(43);
const TODAY = '2026-11-12';

// The order of 12/10: 20 bags of feed at 17 500 F = 350 000 F ordered.
const commande = (): PurchaseOrder =>
  unwrap(
    draftOrder(
      { id: uuid(20), supplierId: SEDIMA, campaignId: BANDE, orderDay: '2026-10-12', reference: null, lines: [{ id: uuid(21), costTypeId: ALIMENT, quantity: 20, unitPrice: 17_500 }] },
      { currency: XOF, counterparties: [{ id: SEDIMA, kind: 'Supplier', archived: false }], costTypes: [{ id: ALIMENT, category: 'Feed', bagWeight: 50_000, orderable: true, archived: false }] },
    ),
  );
const paiement = (rank: number, amount: number, paidOn = '2026-10-13') => unwrap(recordPayment({ id: uuid(rank), orderId: uuid(20), paidOn, amount, method: 'Wave' }, XOF));
const reçus = (count: number) => new Map([[uuid(21), count]]);
const soldeDe = (counterpartyId: string, entries: Parameters<typeof ledgerOf>[0]) => ledgerOf(entries, XOF).find((line) => line.counterpartyId === counterpartyId)?.balance;

const costContext: CostContext = {
  currency: XOF,
  today: TODAY as CostContext['today'],
  costTypes: [{ id: SALAIRE, archived: false }],
  counterparties: [
    { id: OUSMANE, kind: 'Collaborator', archived: false },
    { id: SEDIMA, kind: 'Supplier', archived: false },
    { id: RAMASSEUR, kind: 'Customer', archived: false },
  ],
};
const salaire = (rank: number, fields: Partial<CostInput> = {}): CostInput => ({
  id: uuid(rank),
  campaignId: BANDE,
  costTypeId: SALAIRE,
  spentOn: '2026-11-10',
  amount: 45_000,
  note: null,
  payment: { kind: 'ToPay', counterpartyId: OUSMANE },
  receipt: null,
  recordedAt: `2026-11-10T08:${String(rank % 60).padStart(2, '0')}:00.000Z`,
  ...fields,
});

const settlementContext: SettlementContext = {
  currency: XOF,
  today: TODAY as SettlementContext['today'],
  counterparties: [
    { id: OUSMANE, archived: false },
    { id: SEDIMA, archived: false },
    { id: RAMASSEUR, archived: false },
    { id: uuid(39), archived: true },
  ],
};
const reglement = (rank: number, fields: Partial<SettlementInput> = {}): SettlementInput => ({
  id: uuid(rank),
  counterpartyId: OUSMANE,
  paidOn: '2026-11-11',
  amount: 20_000,
  method: 'Cash',
  direction: 'ToCounterparty',
  ...fields,
});
const regle = (input: SettlementInput) => unwrap(recordSettlement(input, settlementContext));

describe('Les soldes se déduisent des écritures', () => {
  it('reçu et non payé : tu dois au fournisseur (solde négatif)', () => {
    // 20 bags received × 17 500 = 350 000 F billable, nothing paid.
    expect(soldeDe(SEDIMA, orderEntries(commande(), reçus(20), []))).toEqual(signe(-350_000));
  });

  it('payé et non reçu : le fournisseur te doit (solde positif)', () => {
    expect(soldeDe(SEDIMA, orderEntries(commande(), reçus(0), [paiement(501, 100_000)]))).toEqual(signe(100_000));
  });

  it('un paiement de commande reçu deux fois ne compte qu’une fois', () => {
    const une = paiement(501, 100_000);
    expect(soldeDe(SEDIMA, orderEntries(commande(), reçus(20), [une, une]))).toEqual(signe(-250_000));
  });

  it('reçu en partie et payé en partie : la différence, dans son sens', () => {
    // 8 × 17 500 = 140 000 F billable − 100 000 F paid → you owe 40 000 F.
    expect(soldeDe(SEDIMA, orderEntries(commande(), reçus(8), [paiement(501, 100_000)]))).toEqual(signe(-40_000));
  });

  it('une dépense « à payer » crée une dette envers le tiers choisi ; passée en payée, elle ne compte plus', () => {
    const dette = unwrap(recordCost(salaire(301), costContext));
    const payee = unwrap(reviseCost(dette, salaire(302, { payment: { kind: 'Paid' }, recordedAt: '2026-11-11T08:00:00.000Z' }), costContext));

    expect(soldeDe(OUSMANE, costEntries(effectiveCosts([dette])))).toEqual(signe(-45_000));
    expect(ledgerOf(costEntries(effectiveCosts([dette, payee])), XOF)).toEqual([]);
  });

  // Spec: backlog R.4 — payé par un tiers (décisions du 2026-11-12).
  it('une dépense payée par un acheteur baisse sa créance d’autant, définitivement ; ses frais pris en charge aussi', () => {
    // The buyer paid 100 000 F of feed for the farm, and 1 000 F of Wave fees the farm takes on.
    const aliment = unwrap(recordCost(salaire(310, { amount: 100_000, payment: { kind: 'PaidBy', counterpartyId: RAMASSEUR } }), costContext));
    const frais = unwrap(recordCost(salaire(311, { amount: 1_000, payment: { kind: 'PaidBy', counterpartyId: RAMASSEUR } }), costContext));

    expect(soldeDe(RAMASSEUR, costEntries(effectiveCosts([aliment, frais])))).toEqual(signe(-101_000));
    expect(costEntries(effectiveCosts([aliment])).map((entry) => entry.source)).toEqual([{ kind: 'Cost', costId: uuid(310), paidBy: true }]);
  });

  it('un paiement de commande fait par un tiers : la dette envers le fournisseur baisse, et le tiers qui a payé reçoit « − montant »', () => {
    const parMoussa = unwrap(recordPayment({ id: uuid(520), orderId: uuid(20), paidOn: '2026-10-14', amount: 150_000, method: 'Wave', paidBy: RAMASSEUR }, XOF));
    const entries = orderEntries(commande(), reçus(20), [parMoussa]);

    // 20 × 17 500 = 350 000 F billable; 150 000 F paid by the buyer.
    expect(soldeDe(SEDIMA, entries)).toEqual(signe(-200_000));
    expect(soldeDe(RAMASSEUR, entries)).toEqual(signe(-150_000));
  });

  it('le tiers qui a payé une commande se désigne par un identifiant valide', () => {
    expect(recordPayment({ id: uuid(521), orderId: uuid(20), paidOn: '2026-10-14', amount: 1, method: 'Cash', paidBy: 'Moussa' }, XOF)).toEqual({ ok: false, error: { kind: 'InvalidId', expected: 'CounterpartyId' } });
  });

  it('chaque tiers a sa ligne ; ses écritures sont datées, dans les deux sens', () => {
    const dette = unwrap(recordCost(salaire(301), costContext));
    const ledger = ledgerOf([...orderEntries(commande(), reçus(20), [paiement(501, 100_000)]), ...costEntries(effectiveCosts([dette]))], XOF);

    expect(ledger.map(({ counterpartyId, balance }) => [counterpartyId, balance.amount])).toEqual([
      [SEDIMA, -250_000],
      [OUSMANE, -45_000],
    ]);
    expect(ledger[0]?.entries.map(({ on, amount, source }) => [on, amount.amount, source.kind])).toEqual([
      ['2026-10-12', -350_000, 'OrderReceived'],
      ['2026-10-13', 100_000, 'OrderPayment'],
    ]);
  });

  it('le solde d’un tiers est la somme de ses écritures, quel que soit leur ordre (propriété)', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: -1_000_000, max: 1_000_000 }).filter((amount) => amount !== 0), { minLength: 1, maxLength: 10 }), fc.integer(), (amounts, seed) => {
        const entries = amounts.map((amount, index) => ({ counterpartyId: SEDIMA, on: '2026-11-01' as never, amount: signe(amount), source: { kind: 'Settlement' as const, settlementId: uuid(600 + index), method: 'Cash' as const, direction: 'ToCounterparty' as const } }));
        const shuffled = [...entries].sort((a, b) => ((a.amount.amount * 31 + seed) % 7) - ((b.amount.amount * 31 + seed) % 7));
        return soldeDe(SEDIMA, shuffled)?.amount === amounts.reduce((sum, amount) => sum + amount, 0);
      }),
    );
  });

  it('aucun tiers sans écriture ; un tiers soldé garde sa ligne, à zéro', () => {
    expect(ledgerOf([], XOF)).toEqual([]);
    expect(soldeDe(SEDIMA, orderEntries(commande(), reçus(20), [paiement(501, 350_000)]))).toEqual(signe(0));
  });
});

describe('Régler en une ou plusieurs fois', () => {
  const dette = () => costEntries(effectiveCosts([unwrap(recordCost(salaire(301), costContext))]));

  it('un règlement porte sa date, son montant, son moyen et son sens', () => {
    expect(recordSettlement(reglement(701), settlementContext)).toEqual({
      ok: true,
      value: { id: uuid(701), counterpartyId: OUSMANE, paidOn: '2026-11-11', amount: unwrap(Money.of(20_000, XOF)), method: 'Cash', direction: 'ToCounterparty' },
    });
  });

  it('un règlement partiel diminue la dette d’autant : 45 000 − 20 000 = 25 000 F encore dus', () => {
    expect(soldeDe(OUSMANE, [...dette(), ...settlementEntries([regle(reglement(701))])])).toEqual(signe(-25_000));
  });

  it('plusieurs règlements soldent la dette exactement : 20 000 + 25 000 = 45 000 F', () => {
    expect(soldeDe(OUSMANE, [...dette(), ...settlementEntries([regle(reglement(701)), regle(reglement(702, { amount: 25_000, method: 'OrangeMoney' }))])])).toEqual(signe(0));
  });

  it('un règlement plus gros que la dette est accepté : le tiers doit alors la différence', () => {
    expect(soldeDe(OUSMANE, [...dette(), ...settlementEntries([regle(reglement(701, { amount: 50_000 }))])])).toEqual(signe(5_000));
  });

  it('de l’argent reçu du tiers (un fournisseur qui rembourse) diminue sa dette envers toi', () => {
    // Sedima owed 100 000 F (paid, nothing received) and gives back 100 000 F: settled.
    const remboursement = regle(reglement(703, { counterpartyId: SEDIMA, amount: 100_000, direction: 'FromCounterparty' }));
    expect(soldeDe(SEDIMA, [...orderEntries(commande(), reçus(0), [paiement(501, 100_000)]), ...settlementEntries([remboursement])])).toEqual(signe(0));
  });

  it('le même règlement reçu deux fois ne compte qu’une fois', () => {
    const une = regle(reglement(701));
    expect(soldeDe(OUSMANE, [...dette(), ...settlementEntries([une, une])])).toEqual(signe(-25_000));
  });

  it('refuse un montant nul ou fractionnaire, un moyen ou un sens inconnus, un tiers inconnu ou archivé, une date future ou invalide, un identifiant invalide', () => {
    expect(
      [
        reglement(710, { amount: 0 }),
        reglement(711, { amount: 99.5 }),
        reglement(712, { method: 'Cheque' as never }),
        reglement(713, { direction: 'Sideways' as never }),
        reglement(714, { counterpartyId: uuid(98) }),
        reglement(715, { counterpartyId: uuid(39) }),
        reglement(716, { paidOn: '2026-11-13' }),
        reglement(717, { paidOn: 'hier' }),
        reglement(718, { id: 'r-1' }),
      ].map((input) => recordSettlement(input, settlementContext)),
    ).toEqual([
      { ok: false, error: { kind: 'InvalidAmount' } },
      { ok: false, error: { kind: 'InvalidAmount' } },
      { ok: false, error: { kind: 'UnknownPaymentMethod' } },
      { ok: false, error: { kind: 'UnknownDirection' } },
      { ok: false, error: { kind: 'UnknownCounterparty' } },
      { ok: false, error: { kind: 'CounterpartyArchived' } },
      { ok: false, error: { kind: 'PaidInFuture' } },
      { ok: false, error: { kind: 'InvalidBusinessDay' } },
      { ok: false, error: { kind: 'InvalidId', expected: 'SettlementId' } },
    ]);
  });
});
