import { Money, unwrap, type CurrencyCode } from '@kit';
import { describe, expect, it } from 'vitest';
import { Instant } from '../journal/instant';
import {
  acceptsDeliveries,
  announceOrder,
  closeOrder,
  draftOrder,
  orderStatus,
  reviseOrder,
  type DraftOrderContext,
  type DraftOrderInput,
  type PurchaseOrder,
} from './purchase-order';

// Spec: backlog Q.1 — une commande et son cycle ; cahier des charges « Commandes » (une bande par
// commande, référence facultative, lignes sur des types de l'élevage : décisions du 2026-11-09 ;
// le cycle : brouillon, annoncée, partiellement reçue, reçue, close, soldée — un état qui se déduit).

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const XOF = 'XOF' as CurrencyCode;
const SEDIMA = uuid(31);
const RAMASSEUR = uuid(32);
const ANCIEN_FOURNISSEUR = uuid(33);
const BANDE = uuid(4);
const ALIMENT_DEMARRAGE = uuid(41);
const POUSSINS = uuid(42);
const GARDIENNAGE = uuid(43);
const ANCIEN_ALIMENT = uuid(44);
const LIGNE_ALIMENT = uuid(51);
const LIGNE_POUSSINS = uuid(52);
const LE_MATIN = unwrap(Instant('2026-11-09T08:00:00.000Z'));
const LE_SOIR = unwrap(Instant('2026-11-09T18:00:00.000Z'));

// Who and what the farm has: the order is judged against it.
const lElevage = (): DraftOrderContext => ({
  currency: XOF,
  counterparties: [
    { id: SEDIMA, kind: 'Supplier', archived: false },
    { id: RAMASSEUR, kind: 'Customer', archived: false },
    { id: ANCIEN_FOURNISSEUR, kind: 'Supplier', archived: true },
  ],
  costTypes: [
    { id: ALIMENT_DEMARRAGE, orderable: true, archived: false },
    { id: POUSSINS, orderable: true, archived: false },
    { id: GARDIENNAGE, orderable: false, archived: false },
    { id: ANCIEN_ALIMENT, orderable: true, archived: true },
  ],
});

// The founder's order of 12/10, in two lines: 20 bags of starter feed at 17 500 F, 1 000 chicks at 550 F.
const uneCommande = (fields: Partial<DraftOrderInput> = {}): DraftOrderInput => ({
  id: uuid(1),
  supplierId: SEDIMA,
  campaignId: BANDE,
  orderDay: '2026-10-12',
  reference: 'BC-0412',
  lines: [
    { id: LIGNE_ALIMENT, costTypeId: ALIMENT_DEMARRAGE, quantity: 20, unitPrice: 17_500 },
    { id: LIGNE_POUSSINS, costTypeId: POUSSINS, quantity: 1000, unitPrice: 550 },
  ],
  ...fields,
});
const brouillon = (fields: Partial<DraftOrderInput> = {}): PurchaseOrder => unwrap(draftOrder(uneCommande(fields), lElevage()));
const annoncee = (): PurchaseOrder => unwrap(announceOrder(brouillon(), LE_MATIN));
const recu = (aliment: number, poussins: number) =>
  new Map([
    [LIGNE_ALIMENT, aliment],
    [LIGNE_POUSSINS, poussins],
  ]);
const refus = (kind: string, fields: Record<string, unknown> = {}) => ({ ok: false, error: { kind, ...fields } });

describe('Une commande', () => {
  describe('son en-tête et ses lignes', () => {
    it('une commande a un fournisseur, une bande, une date, une référence et ses lignes : type, quantité, prix unitaire en francs', () => {
      const order = brouillon();

      expect(order).toMatchObject({ id: uuid(1), supplierId: SEDIMA, campaignId: BANDE, orderDay: '2026-10-12', reference: 'BC-0412', announcedAt: null, closedAt: null });
      expect(order.lines.map(({ id, costTypeId, quantity, unitPrice }) => ({ id, costTypeId, quantity, unitPrice: unitPrice.amount }))).toEqual([
        { id: LIGNE_ALIMENT, costTypeId: ALIMENT_DEMARRAGE, quantity: 20, unitPrice: 17_500 },
        { id: LIGNE_POUSSINS, costTypeId: POUSSINS, quantity: 1000, unitPrice: 550 },
      ]);
      expect(order.lines.every((line) => line.unitPrice.currency === 'XOF')).toBe(true);
    });

    it('la référence est facultative : absente ou faite d’espaces, elle n’existe pas ; donnée, elle est gardée sans ses espaces autour', () => {
      expect([brouillon({ reference: null }).reference, brouillon({ reference: '   ' }).reference, brouillon({ reference: ' BC 12 ' }).reference]).toEqual([null, null, 'BC 12']);
    });

    it('une commande sans ligne est refusée', () => {
      expect(draftOrder(uneCommande({ lines: [] }), lElevage())).toEqual(refus('OrderWithoutLines'));
    });

    it('le fournisseur est un tiers « fournisseur » de l’élevage, non archivé', () => {
      expect([
        draftOrder(uneCommande({ supplierId: RAMASSEUR }), lElevage()),
        draftOrder(uneCommande({ supplierId: ANCIEN_FOURNISSEUR }), lElevage()),
        draftOrder(uneCommande({ supplierId: uuid(99) }), lElevage()),
      ]).toEqual([refus('NotASupplier'), refus('CounterpartyArchived'), refus('UnknownCounterparty')]);
    });

    it('seuls les types commandables de l’élevage, non archivés, entrent dans une commande', () => {
      const avec = (costTypeId: string) => draftOrder(uneCommande({ lines: [{ id: LIGNE_ALIMENT, costTypeId, quantity: 1, unitPrice: 100 }] }), lElevage());

      expect([avec(GARDIENNAGE), avec(ANCIEN_ALIMENT), avec(uuid(98))]).toEqual([
        refus('CostTypeNotOrderable', { lineId: LIGNE_ALIMENT }),
        refus('CostTypeArchived', { lineId: LIGNE_ALIMENT }),
        refus('UnknownCostType', { lineId: LIGNE_ALIMENT }),
      ]);
    });

    it('une quantité d’au moins un, entière ; un prix en francs entiers, zéro permis, jamais négatif', () => {
      const ligne = (quantity: number, unitPrice: number) => draftOrder(uneCommande({ lines: [{ id: LIGNE_ALIMENT, costTypeId: ALIMENT_DEMARRAGE, quantity, unitPrice }] }), lElevage());

      expect(ligne(1, 0).ok).toBe(true);
      expect([ligne(0, 100), ligne(2.5, 100), ligne(1, -1), ligne(1, 99.5)]).toEqual([
        refus('InvalidQuantity', { lineId: LIGNE_ALIMENT }),
        refus('InvalidQuantity', { lineId: LIGNE_ALIMENT }),
        refus('InvalidUnitPrice', { lineId: LIGNE_ALIMENT }),
        refus('InvalidUnitPrice', { lineId: LIGNE_ALIMENT }),
      ]);
    });

    it('deux lignes ne portent pas le même identifiant ; un identifiant mal formé est refusé ; une date qui n’en est pas une aussi', () => {
      const deux = { id: LIGNE_ALIMENT, costTypeId: ALIMENT_DEMARRAGE, quantity: 1, unitPrice: 100 };

      expect([
        draftOrder(uneCommande({ lines: [deux, deux] }), lElevage()),
        draftOrder(uneCommande({ id: 'commande-1' }), lElevage()),
        draftOrder(uneCommande({ orderDay: '12/10/2026' }), lElevage()),
      ]).toEqual([refus('DuplicateLine', { lineId: LIGNE_ALIMENT }), refus('InvalidId', { expected: 'PurchaseOrderId' }), refus('InvalidBusinessDay')]);
    });

    it('la commande écrite est gelée : rien ne la change en douce', () => {
      const order = brouillon();

      expect([Object.isFrozen(order), Object.isFrozen(order.lines), Object.isFrozen(order.lines[0])]).toEqual([true, true, true]);
    });
  });

  describe('son cycle, une transition à la fois', () => {
    it('brouillon tant qu’elle n’est pas annoncée', () => {
      expect(orderStatus(brouillon(), new Map(), false)).toBe('Draft');
    });

    it('un brouillon s’annonce une fois, à un instant ; annoncer deux fois est refusé', () => {
      const order = annoncee();

      expect(order.announcedAt).toBe(LE_MATIN);
      expect(orderStatus(order, new Map(), false)).toBe('Announced');
      expect(announceOrder(order, LE_SOIR)).toEqual(refus('OrderAlreadyAnnounced'));
    });

    it('partiellement reçue dès qu’une ligne a reçu quelque chose ; reçue quand chaque ligne a sa quantité — un bonus compte', () => {
      expect([orderStatus(annoncee(), recu(5, 0), false), orderStatus(annoncee(), recu(20, 999), false)]).toEqual(['PartiallyReceived', 'PartiallyReceived']);
      expect([orderStatus(annoncee(), recu(20, 1000), false), orderStatus(annoncee(), recu(20, 1050), false)]).toEqual(['Received', 'Received']);
    });

    it('soldée quand elle est reçue et payée — pas avant d’être reçue, même payée', () => {
      expect([orderStatus(annoncee(), recu(20, 1000), true), orderStatus(annoncee(), recu(5, 0), true), orderStatus(annoncee(), new Map(), true)]).toEqual([
        'Settled',
        'PartiallyReceived',
        'Announced',
      ]);
    });

    it('seul un brouillon se modifie : une fois annoncée, la commande ne change plus', () => {
      const revised = unwrap(reviseOrder(brouillon(), uneCommande({ reference: 'BC-0413' }), lElevage()));

      expect(revised.reference).toBe('BC-0413');
      expect(reviseOrder(annoncee(), uneCommande({ reference: 'BC-0413' }), lElevage())).toEqual(refus('OrderAnnounced'));
    });

    it('modifier un brouillon le rejuge entièrement, et ne change pas son identifiant', () => {
      expect(reviseOrder(brouillon(), uneCommande({ id: uuid(2) }), lElevage())).toEqual(refus('OrderIdChanged'));
      expect(reviseOrder(brouillon(), uneCommande({ lines: [] }), lElevage())).toEqual(refus('OrderWithoutLines'));
    });

    it('on ne reçoit que sur une commande annoncée et pas close', () => {
      const close = unwrap(closeOrder(annoncee(), recu(5, 0), LE_SOIR));

      expect([acceptsDeliveries(brouillon()), acceptsDeliveries(annoncee()), acceptsDeliveries(close)]).toEqual([refus('OrderNotAnnounced'), { ok: true, value: undefined }, refus('OrderClosed')]);
    });

    it('l’admin clôt une commande incomplète — même rien reçu : elle est close, et soldée une fois payée', () => {
      const partielle = unwrap(closeOrder(annoncee(), recu(5, 0), LE_SOIR));
      const rienRecu = unwrap(closeOrder(annoncee(), new Map(), LE_SOIR));

      expect(partielle.closedAt).toBe(LE_SOIR);
      expect([orderStatus(partielle, recu(5, 0), false), orderStatus(rienRecu, new Map(), false), orderStatus(partielle, recu(5, 0), true)]).toEqual(['Closed', 'Closed', 'Settled']);
    });

    it('clore un brouillon, une commande déjà reçue ou déjà close est refusé ; une commande close ne se rouvre pas', () => {
      const close = unwrap(closeOrder(annoncee(), recu(5, 0), LE_SOIR));

      expect([closeOrder(brouillon(), new Map(), LE_SOIR), closeOrder(annoncee(), recu(20, 1000), LE_SOIR), closeOrder(close, recu(5, 0), LE_SOIR)]).toEqual([
        refus('OrderNotAnnounced'),
        refus('OrderFullyReceived'),
        refus('OrderClosed'),
      ]);
      expect(announceOrder(close, LE_SOIR)).toEqual(refus('OrderAlreadyAnnounced'));
    });

    it('une réception sur une ligne qui n’est pas de la commande ne compte pas dans son état', () => {
      const ailleurs = new Map([[uuid(77), 5000]]);

      expect(orderStatus(annoncee(), ailleurs, false)).toBe('Announced');
    });

    it('un prix de commande reste un montant exact : 20 sacs à 17 500 F, c’est 350 000 F', () => {
      const ligne = brouillon().lines[0];

      expect(ligne?.unitPrice.times(ligne.quantity)).toEqual({ ok: true, value: unwrap(Money.of(350_000, XOF)) });
    });
  });
});
