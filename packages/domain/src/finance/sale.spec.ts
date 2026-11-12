import { Money, SignedMoney, unwrap, type CurrencyCode } from '@kit';
import { describe, expect, it } from 'vitest';
import { ledgerOf } from './ledger';
import { recordSale, recordSaleReceipt, saleEntries, salesSummary, type SaleContext, type SaleInput } from './sale';

// Spec: backlog W.1 — une vente, sa créance et la marge ; cahier des charges « Les ventes »
// (décisions du fondateur du 2026-11-12 : par tête ou au kilo, payé en tout, en partie ou à
// crédit ; marge = encaissé − engagé) ; CLAUDE.md §4 règles 7, 8 et 10. Montants calculés à la main.

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const XOF = 'XOF' as CurrencyCode;
const F = (amount: number): Money => unwrap(Money.of(amount, XOF));
const BANDE = uuid(4);
const MOUSSA = uuid(33);
const SEDIMA = uuid(31);
const ANCIEN = uuid(39);

const contexte: SaleContext = {
  currency: XOF,
  today: '2026-11-25' as SaleContext['today'],
  counterparties: [
    { id: MOUSSA, kind: 'Customer', archived: false },
    { id: SEDIMA, kind: 'Supplier', archived: false },
    { id: ANCIEN, kind: 'Customer', archived: true },
  ],
};
// 200 birds at 2 750 F a head, sold to Moussa on November 24th.
const uneVente = (rank: number, fields: Partial<SaleInput> = {}): SaleInput => ({
  id: uuid(rank),
  campaignId: BANDE,
  buyerId: MOUSSA,
  soldOn: '2026-11-24',
  birds: 200,
  pricing: { kind: 'PerBird', unitPrice: 2_750 },
  ...fields,
});
const vend = (input: SaleInput) => unwrap(recordSale(input, contexte));
const encaisse = (rank: number, saleId: string, amount: number, paidOn = '2026-11-24') => unwrap(recordSaleReceipt({ id: uuid(rank), saleId, paidOn, amount, method: 'Cash' }, contexte));

describe('Une vente', () => {
  it('porte une date, un nombre de poulets, un prix par tête, un acheteur ; son montant se calcule : 200 × 2 750 = 550 000 F', () => {
    expect(recordSale(uneVente(1), contexte)).toEqual({
      ok: true,
      value: { id: uuid(1), campaignId: BANDE, buyerId: MOUSSA, soldOn: '2026-11-24', birds: 200, pricing: { kind: 'PerBird', unitPrice: F(2_750) }, amount: F(550_000) },
    });
  });

  it('au kilo : le poids pesé en grammes × le prix d’un kilo, au franc près — 452 300 g × 1 200 F = 542 760 F ; 1 250 g × 999 F = 1 248,75 → 1 249 F', () => {
    expect(vend(uneVente(2, { pricing: { kind: 'PerKilo', grams: 452_300, pricePerKilo: 1_200 } })).amount).toEqual(F(542_760));
    expect(vend(uneVente(3, { birds: 1, pricing: { kind: 'PerKilo', grams: 1_250, pricePerKilo: 999 } })).amount).toEqual(F(1_249));
  });

  it('refuse un acheteur qui n’est pas un client, archivé ou inconnu ; zéro poulet ; un prix ou un poids nul ou fractionnaire ; une date future ; un identifiant invalide', () => {
    expect(
      [
        uneVente(10, { buyerId: SEDIMA }),
        uneVente(11, { buyerId: ANCIEN }),
        uneVente(12, { buyerId: uuid(98) }),
        uneVente(13, { birds: 0 }),
        uneVente(14, { birds: 2.5 }),
        uneVente(15, { pricing: { kind: 'PerBird', unitPrice: 0 } }),
        uneVente(16, { pricing: { kind: 'PerKilo', grams: 0, pricePerKilo: 1_200 } }),
        uneVente(17, { pricing: { kind: 'PerKilo', grams: 1_000.5, pricePerKilo: 1_200 } }),
        uneVente(18, { pricing: { kind: 'PerTruck' } as never }),
        uneVente(19, { soldOn: '2026-11-26' }),
        uneVente(20, { id: 'v-1' }),
      ].map((input) => recordSale(input, contexte)),
    ).toEqual([
      { ok: false, error: { kind: 'NotACustomer' } },
      { ok: false, error: { kind: 'CounterpartyArchived' } },
      { ok: false, error: { kind: 'UnknownCounterparty' } },
      { ok: false, error: { kind: 'InvalidBirds' } },
      { ok: false, error: { kind: 'InvalidBirds' } },
      { ok: false, error: { kind: 'InvalidPrice' } },
      { ok: false, error: { kind: 'InvalidWeight' } },
      { ok: false, error: { kind: 'InvalidWeight' } },
      { ok: false, error: { kind: 'UnknownPricing' } },
      { ok: false, error: { kind: 'SoldInFuture' } },
      { ok: false, error: { kind: 'InvalidId', expected: 'SaleId' } },
    ]);
  });
});

describe('La créance sur l’acheteur', () => {
  it('à crédit : l’acheteur doit tout le montant', () => {
    const vente = vend(uneVente(1));

    expect(ledgerOf(saleEntries([vente], []), XOF)[0]?.balance).toEqual(unwrap(SignedMoney.of(550_000, XOF)));
  });

  it('payé en partie : 200 000 F reçus sur le moment, il doit encore 350 000 F ; un second encaissement le solde', () => {
    const vente = vend(uneVente(1));
    const tout = [encaisse(501, uuid(1), 200_000), encaisse(502, uuid(1), 350_000, '2026-11-25')];

    expect(ledgerOf(saleEntries([vente], tout.slice(0, 1)), XOF)[0]?.balance.amount).toBe(350_000);
    expect(ledgerOf(saleEntries([vente], tout), XOF)[0]?.balance.amount).toBe(0);
  });

  it('un encaissement reçu deux fois ne compte qu’une fois ; encaisser plus que la vente : l’élevage doit la différence', () => {
    const vente = vend(uneVente(1));
    const une = encaisse(501, uuid(1), 600_000);

    expect(ledgerOf(saleEntries([vente], [une, une]), XOF)[0]?.balance.amount).toBe(-50_000);
  });

  it('un encaissement porte sa date, un montant d’au moins 1 F et son moyen ; jamais dans le futur', () => {
    expect(recordSaleReceipt({ id: uuid(503), saleId: uuid(1), paidOn: '2026-11-24', amount: 0, method: 'Cash' }, contexte)).toEqual({ ok: false, error: { kind: 'InvalidAmount' } });
    expect(recordSaleReceipt({ id: uuid(504), saleId: uuid(1), paidOn: '2026-11-26', amount: 1, method: 'Wave' }, contexte)).toEqual({ ok: false, error: { kind: 'PaidInFuture' } });
    expect(recordSaleReceipt({ id: uuid(505), saleId: uuid(1), paidOn: '2026-11-24', amount: 1, method: 'Cheque' as never }, contexte)).toEqual({ ok: false, error: { kind: 'UnknownPaymentMethod' } });
  });
});

describe("L'argent de la bande", () => {
  it('avant la première vente, marge et prix moyen sont absents, jamais zéro', () => {
    expect(salesSummary([], [], F(915_000), XOF)).toEqual({ birdsSold: 0, revenue: F(0), cashedIn: F(0), margin: null, averagePrice: null });
  });

  it('chiffre d’affaires, encaissé, marge en direct = encaissé − engagé, prix moyen par poulet', () => {
    // Sales: 200 × 2 750 = 550 000 F; 180 birds by weight, 452 300 g × 1 200 = 542 760 F.
    // Revenue 1 092 760 F for 380 birds → 2 875,68… → 2 876 F a bird.
    // Cashed in: 550 000 + 300 000 = 850 000 F; margin: 850 000 − 915 000 = −65 000 F.
    const parTete = vend(uneVente(1));
    const auKilo = vend(uneVente(2, { birds: 180, pricing: { kind: 'PerKilo', grams: 452_300, pricePerKilo: 1_200 } }));
    const recus = [encaisse(501, uuid(1), 550_000), encaisse(502, uuid(2), 300_000), encaisse(502, uuid(2), 300_000)];

    expect(salesSummary([parTete, auKilo], recus, F(915_000), XOF)).toEqual({
      birdsSold: 380,
      revenue: F(1_092_760),
      cashedIn: F(850_000),
      margin: unwrap(SignedMoney.of(-65_000, XOF)),
      averagePrice: F(2_876),
    });
  });

  it('les encaissements d’une vente d’une autre bande n’entrent pas dans l’encaissé', () => {
    const vente = vend(uneVente(1));
    expect(salesSummary([vente], [encaisse(501, uuid(99), 100_000)], F(0), XOF).cashedIn).toEqual(F(0));
  });
});
