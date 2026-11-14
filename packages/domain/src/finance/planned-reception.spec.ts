import { unwrap, type CurrencyCode } from '@kit';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Instant } from '../journal/instant';
import { dueReceptionLines, planReception, receptionProgress, type PlannedReceptionInput } from './planned-reception';
import { announceOrder, closeOrder, draftOrder, type PurchaseOrder } from './purchase-order';

// Spec: backlog Q.14 — les réceptions prévues ; cahier des charges « Les réceptions prévues »
// (décisions du fondateur du 2026-11-13 : la commande garde sa date ; chaque réception prévue a la
// sienne et une ou plusieurs lignes avec leur quantité ; une réception en retard alerte et se reprogramme).

const XOF = 'XOF' as CurrencyCode;
const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const ALIMENT = uuid(51);
const COPEAUX = uuid(52);
// The order of the 10th of November: 20 bags of feed, 20 bags of litter.
const leBrouillon = (): PurchaseOrder =>
  unwrap(
    draftOrder(
    {
      id: uuid(1),
      supplierId: uuid(31),
      campaignId: uuid(4),
      orderDay: '2026-11-10',
      reference: null,
      lines: [
        { id: ALIMENT, costTypeId: uuid(41), quantity: 20, unitPrice: 18_000 },
        { id: COPEAUX, costTypeId: uuid(42), quantity: 20, unitPrice: 2_000 },
      ],
    },
    {
      currency: XOF,
      counterparties: [{ id: uuid(31), kind: 'Supplier', archived: false }],
      costTypes: [
        { id: uuid(41), category: 'Feed', bagWeight: 50_000, orderable: true, archived: false },
        { id: uuid(42), category: 'Bedding', bagWeight: null, orderable: true, archived: false },
      ],
    },
    ),
  );
const laCommande = (): PurchaseOrder => unwrap(announceOrder(leBrouillon(), unwrap(Instant('2026-11-10T09:00:00.000Z'))));
const prevue = (fields: Partial<PlannedReceptionInput> = {}): PlannedReceptionInput => ({
  receptionId: uuid(101),
  plannedOn: '2026-11-15',
  lines: [
    { orderLineId: ALIMENT, quantity: 10 },
    { orderLineId: COPEAUX, quantity: 10 },
  ],
  ...fields,
});
const recu = (lines: Record<string, number>): ReadonlyMap<string, number> => new Map(Object.entries(lines));

describe('Une réception prévue', () => {
  it('sa date, et une ou plusieurs lignes de la commande avec leur quantité : 10 sacs d’aliment et 10 sacs de copeaux le 15', () => {
    expect(planReception(prevue(), laCommande())).toEqual({
      ok: true,
      value: { receptionId: uuid(101), orderId: uuid(1), plannedOn: '2026-11-15', lines: [{ orderLineId: ALIMENT, quantity: 10 }, { orderLineId: COPEAUX, quantity: 10 }] },
    });
  });

  it('refusée : avant la date de la commande, sans ligne, une ligne d’une autre commande, une quantité nulle ou à virgule, une ligne deux fois, une date qui n’en est pas une', () => {
    expect([
      planReception(prevue({ plannedOn: '2026-11-09' }), laCommande()),
      planReception(prevue({ lines: [] }), laCommande()),
      planReception(prevue({ lines: [{ orderLineId: uuid(99), quantity: 10 }] }), laCommande()),
      planReception(prevue({ lines: [{ orderLineId: ALIMENT, quantity: 0 }] }), laCommande()),
      planReception(prevue({ lines: [{ orderLineId: ALIMENT, quantity: 2.5 }] }), laCommande()),
      planReception(prevue({ lines: [{ orderLineId: ALIMENT, quantity: 5 }, { orderLineId: ALIMENT, quantity: 5 }] }), laCommande()),
      planReception(prevue({ plannedOn: 'jeudi' }), laCommande()),
      planReception(prevue({ receptionId: 'reception' }), laCommande()),
    ]).toEqual([
      { ok: false, error: { kind: 'BeforeOrderDay' } },
      { ok: false, error: { kind: 'NoLines' } },
      { ok: false, error: { kind: 'UnknownOrderLine' } },
      { ok: false, error: { kind: 'InvalidQuantity' } },
      { ok: false, error: { kind: 'InvalidQuantity' } },
      { ok: false, error: { kind: 'DuplicateLine' } },
      { ok: false, error: { kind: 'InvalidBusinessDay' } },
      { ok: false, error: { kind: 'InvalidId' } },
    ]);
  });

  // Spec: backlog Q.15 — « Déclarer des réceptions » : la première réception prévue annonce la commande
  // (décisions du fondateur du 2026-11-14 : prévenir en une fois, ou déclarer des réceptions)
  it('une commande encore en brouillon accepte une réception prévue : c’est déclarer des réceptions, qui l’annonce', () => {
    expect(planReception(prevue(), leBrouillon())).toMatchObject({ ok: true, value: { receptionId: uuid(101), plannedOn: '2026-11-15' } });
  });

  it('une commande close n’attend plus rien : on n’y prévoit plus de réception', () => {
    const close = unwrap(closeOrder(laCommande(), recu({}), unwrap(Instant('2026-11-12T09:00:00.000Z'))));
    expect(planReception(prevue(), close)).toEqual({ ok: false, error: { kind: 'OrderNotReceiving' } });
  });
});

describe('L’avancement des réceptions prévues', () => {
  // Le 15 : 10 sacs d'aliment et 10 de copeaux ; le 25 : 10 sacs d'aliment
  const prevues = () => [unwrap(planReception(prevue(), laCommande())), unwrap(planReception(prevue({ receptionId: uuid(102), plannedOn: '2026-11-25', lines: [{ orderLineId: ALIMENT, quantity: 10 }] }), laCommande()))];

  it('ce que le gardien a reçu remplit les réceptions dans l’ordre de leurs dates : 12 sacs d’aliment font la première, et 2 de la seconde', () => {
    const [premiere, seconde] = receptionProgress(prevues(), recu({ [ALIMENT]: 12, [COPEAUX]: 10 }), '2026-11-20');
    expect(premiere).toEqual({ receptionId: uuid(101), plannedOn: '2026-11-15', state: 'Received', lines: [{ orderLineId: ALIMENT, expected: 10, received: 10, remaining: 0 }, { orderLineId: COPEAUX, expected: 10, received: 10, remaining: 0 }] });
    expect(seconde).toEqual({ receptionId: uuid(102), plannedOn: '2026-11-25', state: 'Coming', lines: [{ orderLineId: ALIMENT, expected: 10, received: 2, remaining: 8 }] });
  });

  it('sa date passée sans tout recevoir : en retard ; le jour même : aujourd’hui ; avant : à venir', () => {
    expect(receptionProgress(prevues(), recu({ [ALIMENT]: 6 }), '2026-11-16').map(({ state }) => state)).toEqual(['Late', 'Coming']);
    expect(receptionProgress(prevues(), recu({}), '2026-11-15').map(({ state }) => state)).toEqual(['Today', 'Coming']);
    expect(receptionProgress(prevues(), recu({ [ALIMENT]: 10, [COPEAUX]: 10 }), '2026-11-26').map(({ state }) => state)).toEqual(['Received', 'Late']);
  });

  it('un bonus ne fait jamais un reste négatif', () => {
    const [premiere] = receptionProgress(prevues(), recu({ [ALIMENT]: 30, [COPEAUX]: 12 }), '2026-11-16');
    expect(premiere?.lines.map(({ remaining }) => remaining)).toEqual([0, 0]);
  });

  it('l’ordre où on lit les réceptions prévues ne change rien', () => {
    const attendu = receptionProgress(prevues(), recu({ [ALIMENT]: 12, [COPEAUX]: 4 }), '2026-11-20');
    fc.assert(
      fc.property(fc.shuffledSubarray(prevues(), { minLength: 2, maxLength: 2 }), (melange) => {
        expect(receptionProgress(melange, recu({ [ALIMENT]: 12, [COPEAUX]: 4 }), '2026-11-20')).toEqual(attendu);
      }),
    );
  });
});

// Spec: backlog Q.15 — le gardien ne voit que des réceptions : à leur date ou en retard, leurs seules
// lignes et ce qui en reste ; rien avant la date (décisions du fondateur du 2026-11-14)
describe('Ce que le gardien attend d’une commande en plusieurs fois', () => {
  const prevues = () => [unwrap(planReception(prevue(), laCommande())), unwrap(planReception(prevue({ receptionId: uuid(102), plannedOn: '2026-11-25', lines: [{ orderLineId: ALIMENT, quantity: 10 }] }), laCommande()))];

  it('avant la date de la première réception, rien', () => {
    expect(dueReceptionLines(receptionProgress(prevues(), recu({}), '2026-11-14'))).toEqual([]);
  });

  it('le jour de la première : ses lignes, et rien de la seconde', () => {
    expect(dueReceptionLines(receptionProgress(prevues(), recu({}), '2026-11-15'))).toEqual([
      { orderLineId: ALIMENT, expected: 10, received: 0, remaining: 10 },
      { orderLineId: COPEAUX, expected: 10, received: 0, remaining: 10 },
    ]);
  });

  it('en retard, ce qui en reste ; une ligne toute reçue n’est plus attendue', () => {
    expect(dueReceptionLines(receptionProgress(prevues(), recu({ [ALIMENT]: 6, [COPEAUX]: 10 }), '2026-11-20'))).toEqual([{ orderLineId: ALIMENT, expected: 10, received: 6, remaining: 4 }]);
  });

  it('deux réceptions dues pour la même ligne s’additionnent : une seule ligne au cahier', () => {
    expect(dueReceptionLines(receptionProgress(prevues(), recu({ [ALIMENT]: 6, [COPEAUX]: 10 }), '2026-11-25'))).toEqual([{ orderLineId: ALIMENT, expected: 20, received: 6, remaining: 14 }]);
  });
});
