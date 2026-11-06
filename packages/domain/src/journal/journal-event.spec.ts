import { unwrap, type Money, type SignedMoney } from '@kit';
import { describe, expect, it } from 'vitest';
import { BusinessDay } from './business-day';
import {
  CampaignId,
  JournalEventId,
  OrderLineId,
  SiteId,
  TaskId,
  TenantId,
  UserId,
  WeighingRequestId,
} from './ids';
import { Instant } from './instant';
import { JournalEvent, type EventEnvelope, type EventType, type Fact } from './journal-event';
import { MediaFingerprint } from './media-fingerprint';
import { Quantity } from './quantity';
import { Weight } from './weight';

// Spec: Cahier des charges — « Architecture des données » (événement immuable, deux dates) ;
// CLAUDE.md §4 règles 1, 2, 4 et 10.
// Les refus à la compilation (`@ts-expect-error`, listes fermées) sont vérifiés par
// `npx nx typecheck domain`.

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const quantite = (count: number): Quantity => unwrap(Quantity(count));
const poids = (grams: number): Weight => unwrap(Weight(grams, { capacityGrams: 5_000 }));
const empreinte = (hexDigit: string): MediaFingerprint => unwrap(MediaFingerprint(hexDigit.repeat(64)));

// The caretaker writes on the evening of November 5th, for that same day.
function signeParLeGardien(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    id: unwrap(JournalEventId(uuid(1))),
    tenantId: unwrap(TenantId(uuid(2))),
    siteId: unwrap(SiteId(uuid(3))),
    campaignId: unwrap(CampaignId(uuid(4))),
    authorId: unwrap(UserId(uuid(5))),
    businessDate: unwrap(BusinessDay('2026-11-05')),
    recordedAt: unwrap(Instant('2026-11-05T18:30:00.000Z')),
    ...overrides,
  };
}

const cinqPoids = (): Weight[] => [poids(1_850), poids(1_900), poids(1_795), poids(2_010), poids(1_843)];

// One sample per event type: a type added to the list without a sample fails the typecheck.
const facts: { readonly [Type in EventType]: Extract<Fact, { type: Type }> } = {
  Death: { type: 'Death', quantity: quantite(3) },
  BagOpened: { type: 'BagOpened', quantity: quantite(1) },
  NoLoss: { type: 'NoLoss' },
  Delivery: {
    type: 'Delivery',
    orderLineId: unwrap(OrderLineId(uuid(6))),
    receivedQuantity: quantite(40),
    deliveryNote: { kind: 'Photographed', media: empreinte('a') },
  },
  Weighing: { type: 'Weighing', weighingRequestId: unwrap(WeighingRequestId(uuid(7))), weights: cinqPoids() },
  TaskDone: { type: 'TaskDone', taskId: unwrap(TaskId(uuid(8))) },
  VoiceMessage: { type: 'VoiceMessage', media: empreinte('b') },
  Photo: { type: 'Photo', media: empreinte('c') },
};

// Total function over the closed list: a type added without its `case` fails the typecheck.
function tell(event: JournalEvent): string {
  switch (event.type) {
    case 'Death':
      return `${event.quantity} morts`;
    case 'BagOpened':
      return `${event.quantity} sacs ouverts`;
    case 'NoLoss':
      return 'rien perdu';
    case 'Delivery':
      return `${event.receivedQuantity} reçus`;
    case 'Weighing':
      return `${event.weights.length} poids`;
    case 'TaskDone':
      return 'tâche faite';
    case 'VoiceMessage':
      return 'message vocal';
    case 'Photo':
      return 'photo';
    default:
      return assertNever(event);
  }
}

function assertNever(value: never): never {
  throw new Error(`type d'événement non traité : ${JSON.stringify(value)}`);
}

// What an event carries, field by field, down to the leaves.
type Carried<T> = T extends Money | SignedMoney
  ? 'un montant'
  : T extends string | number | boolean | null | undefined
    ? never
    : T extends readonly (infer Item)[]
      ? Carried<Item>
      : T extends object
        ? { [Key in keyof T]: Carried<T[Key]> }[keyof T]
        : never;

function fieldNames(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(fieldNames);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([name, inner]) => [name, ...fieldNames(inner)]);
  }
  return [];
}

describe('Événement du journal', () => {
  describe('un fait signé', () => {
    it('un événement porte son identifiant, le tenant, le site, la campagne, son type, son auteur et ses deux dates', () => {
      // When le gardien déclare trois morts
      const event = JournalEvent(signeParLeGardien(), facts.Death);

      // Then
      expect(event).toEqual({
        id: uuid(1),
        tenantId: uuid(2),
        siteId: uuid(3),
        campaignId: uuid(4),
        authorId: uuid(5),
        businessDate: '2026-11-05',
        recordedAt: '2026-11-05T18:30:00.000Z',
        type: 'Death',
        quantity: 3,
      });
    });

    it("la date métier est choisie, la date de saisie est automatique : l'une ne se déduit pas de l'autre", () => {
      // Given le gardien écrit le 6 au matin pour la journée du 5
      const signed = signeParLeGardien({
        businessDate: unwrap(BusinessDay('2026-11-05')),
        recordedAt: unwrap(Instant('2026-11-06T07:10:00.000Z')),
      });

      // When
      const event = JournalEvent(signed, facts.BagOpened);

      // Then
      expect(event.businessDate).toBe('2026-11-05');
      expect(event.recordedAt).toBe('2026-11-06T07:10:00.000Z');
    });

    it("un événement sans auteur, ou sans date de saisie, ne se compile pas", () => {
      const { authorId, recordedAt, ...anonymous } = signeParLeGardien();

      // @ts-expect-error il manque l'auteur et la date de saisie
      const event = JournalEvent(anonymous, facts.NoLoss);

      expect(event.type).toBe('NoLoss');
      expect([authorId, recordedAt]).toHaveLength(2);
    });
  });

  describe('une liste fermée de types', () => {
    it("les types d'événements sont : mort, sac ouvert, rien perdu, réception, pesée, tâche faite, vocal, photo", () => {
      expect(Object.keys(facts)).toEqual([
        'Death',
        'BagOpened',
        'NoLoss',
        'Delivery',
        'Weighing',
        'TaskDone',
        'VoiceMessage',
        'Photo',
      ]);
    });

    it('chaque type se construit, garde ses faits et se lit par une fonction totale', () => {
      for (const fact of Object.values(facts)) {
        const event = JournalEvent(signeParLeGardien(), fact);

        expect(event).toEqual({ ...signeParLeGardien(), ...fact });
        expect(tell(event)).toMatch(/\S/);
      }
    });

    it('un type hors de la liste ne se compile pas', () => {
      // @ts-expect-error une vente n'est pas un événement du journal de terrain
      const sale: Fact = { type: 'Sale', quantity: quantite(200) };

      expect(sale).toBeDefined();
    });

    it("un type inconnu qui contournerait le typage n'entre pas dans le journal", () => {
      const smuggled = { type: 'Sale', quantity: quantite(200) } as unknown as Fact;

      expect(() => JournalEvent(signeParLeGardien(), smuggled)).toThrow(TypeError);
    });
  });

  describe('des faits, jamais une valeur calculée', () => {
    it('une pesée porte ses cinq poids, pas leur moyenne', () => {
      // When
      const event = JournalEvent(signeParLeGardien(), facts.Weighing);

      // Then
      expect(event).toMatchObject({ weights: [1_850, 1_900, 1_795, 2_010, 1_843] });
      // @ts-expect-error la moyenne se recalcule, elle ne se stocke pas
      const withAverage: Fact = { ...facts.Weighing, average: 1_879.6 };
      expect(JournalEvent(signeParLeGardien(), withAverage)).not.toHaveProperty('average');
    });

    it("une réception porte la quantité comptée, ni la quantité attendue ni l'écart", () => {
      // When
      const event = JournalEvent(signeParLeGardien(), facts.Delivery);

      // Then
      expect(event).toMatchObject({ receivedQuantity: 40 });
      // @ts-expect-error l'écart se déduit de la commande, il ne se déclare pas
      const withVariance: Fact = { ...facts.Delivery, expectedQuantity: quantite(50), variance: -10 };
      const recorded = JournalEvent(signeParLeGardien(), withVariance);
      expect(recorded).not.toHaveProperty('expectedQuantity');
      expect(recorded).not.toHaveProperty('variance');
    });

    it('le papier du livreur est photographié, ou déclaré absent : jamais laissé vide', () => {
      // When
      const withPaper = JournalEvent(signeParLeGardien(), facts.Delivery);
      const withoutPaper = JournalEvent(signeParLeGardien(), { ...facts.Delivery, deliveryNote: { kind: 'NoPaper' } });

      // Then
      expect(withPaper).toMatchObject({ deliveryNote: { kind: 'Photographed', media: 'a'.repeat(64) } });
      expect(withoutPaper).toMatchObject({ deliveryNote: { kind: 'NoPaper' } });
      // @ts-expect-error un papier ni photographié ni déclaré absent
      const unknownPaper: Fact = { ...facts.Delivery, deliveryNote: null };
      expect(() => JournalEvent(signeParLeGardien(), unknownPaper)).toThrow(TypeError);
    });

    it('« rien perdu » est un événement à part entière, pas une mort de quantité zéro', () => {
      // When
      const event = JournalEvent(signeParLeGardien(), facts.NoLoss);

      // Then
      expect(event.type).toBe('NoLoss');
      expect(event).not.toHaveProperty('quantity');
    });

    it("un champ glissé hors du schéma n'entre pas dans le journal", () => {
      // Given une signature et un fait qui transportent chacun un champ en trop
      const signed = { ...signeParLeGardien(), deviceModel: 'Tecno Spark' };
      const fact = { ...facts.Death, cause: 'chaleur' };

      // When
      const event = JournalEvent(signed, fact);

      // Then
      expect(event).toEqual({ ...signeParLeGardien(), ...facts.Death });
    });
  });

  describe('immuable', () => {
    it('un événement construit ne peut plus être modifié', () => {
      // Given
      const event = JournalEvent(signeParLeGardien(), facts.Death);

      // Then
      expect(Object.isFrozen(event)).toBe(true);
      expect(() => {
        // @ts-expect-error la date métier d'un événement ne se réécrit pas
        event.businessDate = unwrap(BusinessDay('2026-11-04'));
      }).toThrow(TypeError);
      expect(() => {
        (event as { quantity: Quantity }).quantity = quantite(2);
      }).toThrow(TypeError);
      expect(event).toMatchObject({ businessDate: '2026-11-05', quantity: 3 });
    });

    it('ni ses poids ni le papier du livreur ne peuvent être modifiés', () => {
      // Given
      const weighing = JournalEvent(signeParLeGardien(), facts.Weighing);
      const delivery = JournalEvent(signeParLeGardien(), facts.Delivery);

      // Then
      expect(() => (weighing as unknown as { weights: Weight[] }).weights.push(poids(3_000))).toThrow(TypeError);
      expect(() => {
        (delivery as { deliveryNote: { kind: string } }).deliveryNote.kind = 'NoPaper';
      }).toThrow(TypeError);
      expect(weighing).toMatchObject({ weights: [1_850, 1_900, 1_795, 2_010, 1_843] });
    });

    it("modifier après coup ce qui a servi à le construire ne le change pas", () => {
      // Given
      const signed = signeParLeGardien();
      const weights = cinqPoids();
      const event = JournalEvent(signed, { ...facts.Weighing, weights });

      // When l'appelant retouche ses propres objets
      weights[0] = poids(4_000);
      weights.push(poids(4_500));
      (signed as { businessDate: BusinessDay }).businessDate = unwrap(BusinessDay('2026-11-01'));

      // Then
      expect(event).toMatchObject({ businessDate: '2026-11-05', weights: [1_850, 1_900, 1_795, 2_010, 1_843] });
    });
  });

  describe('sans argent', () => {
    it("aucun type d'événement ne porte de montant", () => {
      // Compile time: no field of any event type, at any depth, is a `Money` or a `SignedMoney`.
      const carriesNoMoney: [Carried<JournalEvent>] extends [never] ? true : false = true;

      expect(carriesNoMoney).toBe(true);
    });

    it("aucun champ d'aucun type n'a le nom d'un montant", () => {
      const moneyLike = /amount|price|cost|money|currency|debt|billable|payment|xof|fcfa/i;

      for (const fact of Object.values(facts)) {
        const names = fieldNames(JournalEvent(signeParLeGardien(), fact));

        expect(names.filter((name) => moneyLike.test(name))).toEqual([]);
      }
    });
  });
});
