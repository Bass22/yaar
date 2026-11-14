import { Money, SignedMoney, unwrap, type CurrencyCode } from '@kit';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Instant } from '../journal/instant';
import { billableOf, orderBalance, paidAhead, PAYMENT_METHODS, recordPayment, type Payment, type PaymentInput } from './order-balance';
import { announceOrder, closeOrder, draftOrder, orderStatus, type PurchaseOrder } from './purchase-order';

// Spec: backlog Q.3 — facturable, paiements et solde ; architecture §4 (facturable, dette) ;
// cahier des charges « Commandes » (l'argent d'une commande : décisions du 2026-11-09) ;
// CLAUDE.md §4 règles 7 (jamais de flottant), 8 (projections) et 9 (écarts signés).
// Les montants attendus sont calculés à la main en commentaire, sur la commande du 12/10.

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const XOF = 'XOF' as CurrencyCode;
const F = (amount: number): Money => unwrap(Money.of(amount, XOF));
const signe = (amount: number): SignedMoney => unwrap(SignedMoney.of(amount, XOF));
const COMMANDE = uuid(1);
const VETO = uuid(51);
const ALIMENT = uuid(52);
const POUSSINS = uuid(53);

// The order of 12/10: 1 lot of vaccines at 25 000 F, 20 bags of feed at 17 500 F, 1 000 chicks at 550 F.
// Ordered: 25 000 + 20 × 17 500 + 1 000 × 550 = 25 000 + 350 000 + 550 000 = 925 000 F.
const laCommande = (): PurchaseOrder => {
  const draft = draftOrder(
    {
      id: COMMANDE,
      supplierId: uuid(31),
      campaignId: uuid(4),
      orderDay: '2026-10-12',
      reference: null,
      lines: [
        { id: VETO, costTypeId: uuid(41), quantity: 1, unitPrice: 25_000 },
        { id: ALIMENT, costTypeId: uuid(42), quantity: 20, unitPrice: 17_500 },
        { id: POUSSINS, costTypeId: uuid(43), quantity: 1000, unitPrice: 550 },
      ],
    },
    {
      currency: XOF,
      counterparties: [{ id: uuid(31), kind: 'Supplier', archived: false }],
      costTypes: [41, 42, 43].map((rank) => ({ id: uuid(rank), category: 'Feed', bagWeight: 50_000, orderable: true, archived: false })),
    },
  );
  return unwrap(announceOrder(unwrap(draft), unwrap(Instant('2026-10-12T09:00:00.000Z'))));
};
const recu = (lines: Record<string, number>): ReadonlyMap<string, number> => new Map(Object.entries(lines));
const paye = (rank: number, amount: number, paidOn = '2026-10-13', method: PaymentInput['method'] = 'Wave'): Payment =>
  unwrap(recordPayment({ id: uuid(rank), orderId: COMMANDE, paidOn, amount, method }, XOF));

describe("L'argent d'une commande", () => {
  describe('le facturable', () => {
    it('ligne par ligne, facturable = min(reçu, quantité) × prix unitaire ; tout reçu, c’est la commande entière', () => {
      // 25 000 + 350 000 + 550 000 = 925 000 F
      const billable = unwrap(billableOf(laCommande(), recu({ [VETO]: 1, [ALIMENT]: 20, [POUSSINS]: 1000 })));

      expect(billable.lines).toEqual([
        { lineId: VETO, billable: F(25_000) },
        { lineId: ALIMENT, billable: F(350_000) },
        { lineId: POUSSINS, billable: F(550_000) },
      ]);
      expect(billable.total).toEqual(F(925_000));
    });

    it('un bonus n’augmente pas le facturable : 1 050 poussins reçus pour 1 000 commandés, on paie 1 000', () => {
      // min(1 050, 1 000) × 550 = 550 000 F
      expect(unwrap(billableOf(laCommande(), recu({ [POUSSINS]: 1050 }))).lines[2]).toEqual({ lineId: POUSSINS, billable: F(550_000) });
    });

    it('un manque le diminue : 980 poussins reçus, on paie 980', () => {
      // min(980, 1 000) × 550 = 539 000 F
      expect(unwrap(billableOf(laCommande(), recu({ [POUSSINS]: 980 }))).lines[2]).toEqual({ lineId: POUSSINS, billable: F(539_000) });
    });

    it('le coût naît à la réception : commandée, annoncée, même payée, une commande sans réception ne coûte rien encore', () => {
      expect(unwrap(billableOf(laCommande(), new Map())).total).toEqual(F(0));
      expect(unwrap(orderBalance(laCommande(), new Map(), [paye(1, 400_000)])).billable).toEqual(F(0));
    });

    it('livrée en trois fois, le facturable suit chaque réception : le 12, le 14, le 16', () => {
      // Le 12 : véto, 25 000 F. Le 14 : + 350 000 = 375 000 F. Le 16 : + 550 000 = 925 000 F.
      const facturable = (lines: Record<string, number>) => unwrap(billableOf(laCommande(), recu(lines))).total;

      expect([facturable({ [VETO]: 1 }), facturable({ [VETO]: 1, [ALIMENT]: 20 }), facturable({ [VETO]: 1, [ALIMENT]: 20, [POUSSINS]: 1000 })]).toEqual([F(25_000), F(375_000), F(925_000)]);
    });
  });

  describe('les paiements', () => {
    it('un paiement porte une date, un montant en francs et un moyen : espèces, Wave ou Orange Money', () => {
      expect(recordPayment({ id: uuid(1), orderId: COMMANDE, paidOn: '2026-10-13', amount: 400_000, method: 'Cash' }, XOF)).toEqual({
        ok: true,
        value: { id: uuid(1), orderId: COMMANDE, paidOn: '2026-10-13', amount: F(400_000), method: 'Cash' },
      });
      expect(PAYMENT_METHODS).toEqual(['Cash', 'Wave', 'OrangeMoney']);
      expect(recordPayment({ id: uuid(1), orderId: COMMANDE, paidOn: '2026-10-13', amount: 400_000, method: 'OrangeMoney' }, XOF)).toMatchObject({ ok: true, value: { method: 'OrangeMoney' } });
    });

    it('un montant nul, négatif ou fractionnaire, un moyen inconnu, une date ou un identifiant invalides sont refusés', () => {
      const payment = (fields: Partial<PaymentInput>) => recordPayment({ id: uuid(1), orderId: COMMANDE, paidOn: '2026-10-13', amount: 1000, method: 'Wave', ...fields }, XOF);

      expect([payment({ amount: 0 }), payment({ amount: -500 }), payment({ amount: 99.5 }), payment({ method: 'Cheque' as never }), payment({ paidOn: 'hier' }), payment({ id: 'p-1' })]).toEqual([
        { ok: false, error: { kind: 'InvalidAmount' } },
        { ok: false, error: { kind: 'InvalidAmount' } },
        { ok: false, error: { kind: 'InvalidAmount' } },
        { ok: false, error: { kind: 'UnknownPaymentMethod' } },
        { ok: false, error: { kind: 'InvalidBusinessDay' } },
        { ok: false, error: { kind: 'InvalidId', expected: 'PaymentId' } },
      ]);
    });

    it('plusieurs paiements se cumulent, avant comme après les réceptions ; ceux d’une autre commande n’y entrent pas', () => {
      // 400 000 + 525 000 = 925 000 F ; le paiement d'une autre commande est ignoré
      const autre = unwrap(recordPayment({ id: uuid(9), orderId: uuid(2), paidOn: '2026-10-13', amount: 50_000, method: 'Cash' }, XOF));

      expect(unwrap(orderBalance(laCommande(), new Map(), [paye(1, 400_000), paye(2, 525_000, '2026-10-20', 'Cash'), autre])).paid).toEqual(F(925_000));
    });

    it('un paiement reçu deux fois ne compte qu’une fois', () => {
      expect(unwrap(orderBalance(laCommande(), new Map(), [paye(1, 400_000), paye(1, 400_000)])).paid).toEqual(F(400_000));
    });
  });

  describe('le solde', () => {
    it('dette = payé − facturable : négative, l’élevage doit au fournisseur', () => {
      // Le 14 : facturable 375 000 F, rien payé : −375 000 F
      expect(unwrap(orderBalance(laCommande(), recu({ [VETO]: 1, [ALIMENT]: 20 }), [])).debt).toEqual(signe(-375_000));
    });

    it('positive, le fournisseur doit à l’élevage : payé avant d’être livré', () => {
      // Le 14 : payé 400 000 F le 13, facturable 375 000 F : +25 000 F
      expect(unwrap(orderBalance(laCommande(), recu({ [VETO]: 1, [ALIMENT]: 20 }), [paye(1, 400_000)])).debt).toEqual(signe(25_000));
    });

    it('soldée quand elle est reçue et que le payé égale le facturable : la commande du 12/10, payée en deux fois', () => {
      // Facturable 925 000 F ; payé 400 000 + 525 000 = 925 000 F ; dette 0
      const toutRecu = recu({ [VETO]: 1, [ALIMENT]: 20, [POUSSINS]: 1050 });
      const balance = unwrap(orderBalance(laCommande(), toutRecu, [paye(1, 400_000), paye(2, 525_000, '2026-10-20', 'Cash')]));

      expect(balance).toMatchObject({ billable: F(925_000), paid: F(925_000), debt: signe(0), paidInFull: true });
      expect(orderStatus(laCommande(), toutRecu, balance.paidInFull)).toBe('Settled');
    });

    it('trop payé n’est pas soldé : le fournisseur doit encore', () => {
      const toutRecu = recu({ [VETO]: 1, [ALIMENT]: 20, [POUSSINS]: 1000 });
      const balance = unwrap(orderBalance(laCommande(), toutRecu, [paye(1, 930_000)]));

      expect([balance.debt, balance.paidInFull, orderStatus(laCommande(), toutRecu, balance.paidInFull)]).toEqual([signe(5_000), false, 'Received']);
    });

    it('une commande close, payée de ce qui a été reçu, est soldée : seul le reçu se facture', () => {
      // 20 sacs seulement, puis close : facturable 350 000 F, payé 350 000 F
      const recuAliment = recu({ [ALIMENT]: 20 });
      const close = unwrap(closeOrder(laCommande(), recuAliment, unwrap(Instant('2026-10-20T10:00:00.000Z'))));
      const balance = unwrap(orderBalance(close, recuAliment, [paye(1, 350_000)]));

      expect([balance.billable, balance.paidInFull, orderStatus(close, recuAliment, balance.paidInFull)]).toEqual([F(350_000), true, 'Settled']);
    });

    it('payé en entier mais pas encore reçu en entier : pas soldée', () => {
      const unPeu = recu({ [VETO]: 1 });
      const balance = unwrap(orderBalance(laCommande(), unPeu, [paye(1, 25_000)]));

      expect([balance.paidInFull, orderStatus(laCommande(), unPeu, balance.paidInFull)]).toEqual([true, 'PartiallyReceived']);
    });

    it('pour toute suite de réceptions et de paiements, le solde ne dépend ni de leur ordre ni de leurs doublons (property-based)', () => {
      const aPayment = fc.tuple(fc.integer({ min: 1, max: 40 }), fc.integer({ min: 1, max: 500_000 })).map(([rank, amount]) => paye(100 + rank, amount));
      const aCase = fc.tuple(
        fc.record({ [VETO]: fc.nat({ max: 3 }), [ALIMENT]: fc.nat({ max: 30 }), [POUSSINS]: fc.nat({ max: 1200 }) }),
        fc.uniqueArray(aPayment, { maxLength: 8, selector: (payment) => payment.id }),
      );
      const aCaseAndItsReplay = aCase.chain(([received, payments]) =>
        fc.tuple(fc.constant(received), fc.constant(payments), fc.shuffledSubarray([...payments, ...payments], { minLength: payments.length * 2 })),
      );

      fc.assert(
        fc.property(aCaseAndItsReplay, ([received, payments, replayed]) => {
          // payé = somme des paiements distincts ; dette = payé − facturable
          const balance = unwrap(orderBalance(laCommande(), recu(received), replayed));
          const paid = payments.reduce((total, payment) => total + payment.amount.amount, 0);
          const billable = Math.min(received[VETO] ?? 0, 1) * 25_000 + Math.min(received[ALIMENT] ?? 0, 20) * 17_500 + Math.min(received[POUSSINS] ?? 0, 1000) * 550;

          expect([balance.paid, balance.billable, balance.debt]).toEqual([F(paid), F(billable), signe(paid - billable)]);
        }),
      );
    });
  });
});

// Spec: backlog R.8 — « payé d'avance » (le fondateur a lu « il te doit » pour un fournisseur payé avant de livrer)
describe('Payé d’avance', () => {
  it('payé, rien encore reçu : tout ce qui est payé attend sa livraison', () => {
    expect(paidAhead(laCommande(), recu({}), [paye(61, 180_000)])).toEqual(F(180_000));
  });

  it('reçu en partie : ce qui est payé au-delà du facturable — 400 000 payés, 10 sacs reçus (175 000) → 225 000', () => {
    expect(paidAhead(laCommande(), recu({ [ALIMENT]: 10 }), [paye(61, 400_000)])).toEqual(F(225_000));
  });

  it('payé moins que reçu : rien d’avance, la commande doit encore', () => {
    expect(paidAhead(laCommande(), recu({ [ALIMENT]: 20 }), [paye(61, 100_000)])).toEqual(F(0));
  });

  it('une commande entièrement reçue, ou close, n’a plus rien à livrer : un trop-payé y est une vraie dette du fournisseur', () => {
    const toutRecu = recu({ [VETO]: 1, [ALIMENT]: 20, [POUSSINS]: 1000 });
    const close = unwrap(closeOrder(laCommande(), recu({}), unwrap(Instant('2026-10-20T09:00:00.000Z'))));
    expect([paidAhead(laCommande(), toutRecu, [paye(61, 1_000_000)]), paidAhead(close, recu({}), [paye(61, 180_000)])]).toEqual([F(0), F(0)]);
  });
});

