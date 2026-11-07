import { unwrap } from '@kit';
import fc from 'fast-check';
import {
  BusinessDay,
  CampaignId,
  CounterDeclaration,
  Declaration,
  Instant,
  JournalEventId,
  MediaFingerprint,
  OrderLineId,
  Quantity,
  Retraction,
  SiteId,
  TaskId,
  TenantId,
  UserId,
  WeighingRequestId,
  Weight,
  type EventEnvelope,
  type Fact,
} from '@domain/journal';
import { decodeJournalEvent, type DecodingContext } from './decode-event';

// Spec: Architecture §5 (le journal reçu du téléphone) ; CLAUDE.md §4 règles 2 (des faits,
// jamais une valeur calculée) et 6 (entrée inconnue rejetée) ; backlog F.1. Ce que le
// téléphone envoie est traduit, à la frontière de l'API, en un événement du journal construit
// par le domaine, ou refusé avec un motif.

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const MEDIA = 'a'.repeat(64);
const SCALE = { capacityGrams: 5_000 };

const TENANT = unwrap(TenantId(uuid(2)));
const SITE = unwrap(SiteId(uuid(3)));
const SITE_WITHOUT_SCALE = unwrap(SiteId(uuid(33)));
const OUSMANE = unwrap(UserId(uuid(5)));

// The session of the caller: it alone says who writes and for which farm.
const deLaSession: DecodingContext = {
  tenantId: TENANT,
  authorId: OUSMANE,
  scaleOf: (siteId) => (siteId === SITE ? SCALE : null),
};

// What the phone sends for three deaths on November 5th, unless said otherwise.
const envoi = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: uuid(1),
  siteId: uuid(3),
  campaignId: uuid(4),
  businessDate: '2026-11-05',
  recordedAt: '2026-11-05T18:30:00.000Z',
  fact: { type: 'Death', quantity: 3 },
  ...overrides,
});

const envelope = (id = uuid(1), siteId = uuid(3)): EventEnvelope => ({
  id: unwrap(JournalEventId(id)),
  tenantId: TENANT,
  siteId: unwrap(SiteId(siteId)),
  campaignId: unwrap(CampaignId(uuid(4))),
  authorId: OUSMANE,
  businessDate: unwrap(BusinessDay('2026-11-05')),
  recordedAt: unwrap(Instant('2026-11-05T18:30:00.000Z')),
});

const q = (value: number) => unwrap(Quantity(value));
const decode = (raw: unknown) => decodeJournalEvent(raw, deLaSession);
// The same object, without one field.
const without = (raw: Record<string, unknown>, field: string): Record<string, unknown> => Object.fromEntries(Object.entries(raw).filter(([key]) => key !== field));

describe("Décoder un événement reçu du téléphone", () => {
  describe('une déclaration bien formée devient un événement du journal', () => {
    // Each type of fact, as sent, then as the journal holds it.
    const cases: readonly (readonly [string, Record<string, unknown>, Fact])[] = [
      ['des morts', { type: 'Death', quantity: 3 }, { type: 'Death', quantity: q(3) }],
      ['un sac ouvert', { type: 'BagOpened', quantity: 1 }, { type: 'BagOpened', quantity: q(1) }],
      ['« rien perdu »', { type: 'NoLoss' }, { type: 'NoLoss' }],
      ['des poussins manquants', { type: 'Loss', lossType: 'Missing', quantity: 12 }, { type: 'Loss', lossType: 'Missing', quantity: q(12) }],
      ['un don', { type: 'Loss', lossType: 'Donation', quantity: 2 }, { type: 'Loss', lossType: 'Donation', quantity: q(2) }],
      [
        'une réception avec son PV photographié',
        { type: 'Delivery', orderLineId: uuid(7), receivedQuantity: 40, deliveryNote: { kind: 'Photographed', media: MEDIA } },
        { type: 'Delivery', orderLineId: unwrap(OrderLineId(uuid(7))), receivedQuantity: q(40), deliveryNote: { kind: 'Photographed', media: unwrap(MediaFingerprint(MEDIA)) } },
      ],
      [
        'une réception sans papier',
        { type: 'Delivery', orderLineId: uuid(7), receivedQuantity: 40, deliveryNote: { kind: 'NoPaper' } },
        { type: 'Delivery', orderLineId: unwrap(OrderLineId(uuid(7))), receivedQuantity: q(40), deliveryNote: { kind: 'NoPaper' } },
      ],
      [
        'une pesée : les poids lus, jamais leur moyenne',
        { type: 'Weighing', weighingRequestId: uuid(8), weights: [1820, 1905, 1760, 1880, 1850] },
        { type: 'Weighing', weighingRequestId: unwrap(WeighingRequestId(uuid(8))), weights: [1820, 1905, 1760, 1880, 1850].map((grams) => unwrap(Weight(grams, SCALE))) },
      ],
      ['une tâche faite', { type: 'TaskDone', taskId: uuid(9) }, { type: 'TaskDone', taskId: unwrap(TaskId(uuid(9))) }],
      ['un message vocal', { type: 'VoiceMessage', media: MEDIA }, { type: 'VoiceMessage', media: unwrap(MediaFingerprint(MEDIA)) }],
      ['une photo', { type: 'Photo', media: MEDIA }, { type: 'Photo', media: unwrap(MediaFingerprint(MEDIA)) }],
    ];

    it.each(cases)('%s', (_name, fact, expected) => {
      expect(decode(envoi({ fact }))).toEqual({ ok: true, value: Declaration(envelope(), expected) });
    });

    it("une contre-déclaration nomme la déclaration qu'elle corrige et porte le fait qui la remplace", () => {
      const sent = envoi({ id: uuid(100), corrects: uuid(1), fact: { type: 'Death', quantity: 2 } });

      expect(decode(sent)).toEqual({ ok: true, value: CounterDeclaration(envelope(uuid(100)), unwrap(JournalEventId(uuid(1))), { type: 'Death', quantity: q(2) }) });
    });

    it('une annulation nomme la déclaration annulée et ne porte aucun fait', () => {
      expect(decode({ ...without(envoi({ id: uuid(200) }), 'fact'), retracts: uuid(1) })).toEqual({ ok: true, value: Retraction(envelope(uuid(200)), unwrap(JournalEventId(uuid(1)))) });
    });

    it("l'événement décodé est gelé : rien ne le modifie après coup", () => {
      const event = unwrap(decode(envoi()));

      expect(Object.isFrozen(event)).toBe(true);
    });
  });

  describe("l'auteur et l'élevage viennent de la session, jamais du corps", () => {
    it("l'événement porte l'élevage et l'auteur de la session", () => {
      const event = unwrap(decodeJournalEvent(envoi(), { ...deLaSession, authorId: unwrap(UserId(uuid(6))) }));

      expect(event).toMatchObject({ tenantId: TENANT, authorId: uuid(6) });
    });

    it("un corps qui nomme un auteur, un élevage, un appareil ou une date de réception est refusé, sans qu'aucune de ces valeurs soit prise", () => {
      for (const field of ['authorId', 'tenantId', 'deviceId', 'receivedAt']) {
        expect(decode(envoi({ [field]: uuid(66) }))).toEqual({ ok: false, error: { kind: 'UnknownField', field } });
      }
    });
  });

  describe('une entrée inconnue ou mal formée est refusée avec un motif typé', () => {
    it("un type hors de la liste fermée est refusé, y compris le nom d'une propriété que tout objet hérite", () => {
      for (const type of ['Theft', 'death', '', 42, null, 'constructor', 'toString', '__proto__']) {
        expect(decode(envoi({ fact: { type, quantity: 3 } }))).toEqual({ ok: false, error: { kind: 'UnknownEventType' } });
      }
    });

    it("un champ manquant est refusé en le nommant", () => {
      for (const field of ['id', 'siteId', 'campaignId', 'businessDate', 'recordedAt', 'fact']) {
        expect(decode(without(envoi(), field))).toEqual({ ok: false, error: { kind: 'MalformedEvent', field } });
      }
      expect(decode(envoi({ fact: { type: 'Death' } }))).toEqual({ ok: false, error: { kind: 'MalformedEvent', field: 'fact.quantity' } });
      expect(decode(envoi({ fact: { type: 'Delivery', orderLineId: uuid(7), receivedQuantity: 40 } }))).toEqual({ ok: false, error: { kind: 'MalformedEvent', field: 'fact.deliveryNote' } });
      // An absent identifier or media is a missing field, not an invalid one.
      expect(decode(envoi({ fact: { type: 'TaskDone' } }))).toEqual({ ok: false, error: { kind: 'MalformedEvent', field: 'fact.taskId' } });
      expect(decode(envoi({ fact: { type: 'Photo' } }))).toEqual({ ok: false, error: { kind: 'MalformedEvent', field: 'fact.media' } });
      expect(decode(envoi({ fact: { type: 'Delivery', receivedQuantity: 40, deliveryNote: { kind: 'NoPaper' } } }))).toEqual({ ok: false, error: { kind: 'MalformedEvent', field: 'fact.orderLineId' } });
    });

    it("une valeur du mauvais type JSON est refusée en la nommant : un nombre écrit en texte n'est pas un nombre", () => {
      expect(decode(envoi({ fact: { type: 'Death', quantity: '3' } }))).toEqual({ ok: false, error: { kind: 'MalformedEvent', field: 'fact.quantity' } });
      expect(decode(envoi({ fact: { type: 'Weighing', weighingRequestId: uuid(8), weights: '1820' } }))).toEqual({ ok: false, error: { kind: 'MalformedEvent', field: 'fact.weights' } });
      expect(decode(envoi({ fact: { type: 'Weighing', weighingRequestId: uuid(8), weights: [1820, '1905'] } }))).toEqual({ ok: false, error: { kind: 'MalformedEvent', field: 'fact.weights' } });
      expect(decode(envoi({ fact: 'Death' }))).toEqual({ ok: false, error: { kind: 'MalformedEvent', field: 'fact' } });
    });

    it("ce qui n'est pas un objet n'est pas un événement", () => {
      for (const raw of [null, undefined, 'Death', 3, [envoi()]]) {
        expect(decode(raw)).toEqual({ ok: false, error: { kind: 'MalformedEvent', field: '' } });
      }
    });

    it("un champ inconnu, dans l'événement ou dans son fait, est refusé en le nommant", () => {
      expect(decode(envoi({ average: 1843 }))).toEqual({ ok: false, error: { kind: 'UnknownField', field: 'average' } });
      expect(decode(envoi({ fact: { type: 'Death', quantity: 3, cause: 'heat' } }))).toEqual({ ok: false, error: { kind: 'UnknownField', field: 'fact.cause' } });
      expect(decode(envoi({ fact: { type: 'Delivery', orderLineId: uuid(7), receivedQuantity: 40, deliveryNote: { kind: 'NoPaper', media: MEDIA } } }))).toEqual({
        ok: false,
        error: { kind: 'UnknownField', field: 'fact.deliveryNote.media' },
      });
    });

    it("pour tout champ ajouté à un envoi valide, l'envoi est refusé et le champ nommé (property-based)", () => {
      const known = new Set(['id', 'siteId', 'campaignId', 'businessDate', 'recordedAt', 'fact', 'corrects', 'retracts']);
      fc.assert(
        fc.property(
          fc.string({ minLength: 1 }).filter((name) => !known.has(name) && name !== '__proto__'),
          fc.jsonValue(),
          (name, value) => {
            expect(decode({ ...envoi(), [name]: value })).toEqual({ ok: false, error: { kind: 'UnknownField', field: name } });
          },
        ),
      );
    });

    it("une valeur invalide reçoit le motif de la règle qui la refuse", () => {
      expect(decode(envoi({ id: 'ABC' }))).toEqual({ ok: false, error: { kind: 'InvalidId', expected: 'JournalEventId' } });
      expect(decode(envoi({ campaignId: '0000000A-0000-4000-8000-00000000000B' }))).toEqual({ ok: false, error: { kind: 'InvalidId', expected: 'CampaignId' } });
      expect(decode(envoi({ businessDate: '2026-02-30' }))).toEqual({ ok: false, error: { kind: 'InvalidBusinessDay' } });
      expect(decode(envoi({ recordedAt: '2026-11-05T18:30:00+00:00' }))).toEqual({ ok: false, error: { kind: 'InvalidInstant' } });
      expect(decode(envoi({ fact: { type: 'Death', quantity: 0 } }))).toEqual({ ok: false, error: { kind: 'InvalidQuantity', value: 0 } });
      expect(decode(envoi({ fact: { type: 'Death', quantity: 2.5 } }))).toEqual({ ok: false, error: { kind: 'InvalidQuantity', value: 2.5 } });
      expect(decode(envoi({ fact: { type: 'Photo', media: 'photo.jpg' } }))).toEqual({ ok: false, error: { kind: 'InvalidMediaFingerprint' } });
      expect(decode(envoi({ fact: { type: 'TaskDone', taskId: 'arroser' } }))).toEqual({ ok: false, error: { kind: 'InvalidId', expected: 'TaskId' } });
    });

    it("un type de perte ou un papier de livreur hors liste est refusé en le nommant", () => {
      expect(decode(envoi({ fact: { type: 'Loss', lossType: 'Theft', quantity: 3 } }))).toEqual({ ok: false, error: { kind: 'MalformedEvent', field: 'fact.lossType' } });
      expect(decode(envoi({ fact: { type: 'Delivery', orderLineId: uuid(7), receivedQuantity: 40, deliveryNote: { kind: 'Lost' } } }))).toEqual({
        ok: false,
        error: { kind: 'MalformedEvent', field: 'fact.deliveryNote.kind' },
      });
    });
  });

  describe("la forme d'une correction ou d'une annulation", () => {
    it("une annulation ne porte pas de fait, et ne corrige pas en même temps", () => {
      expect(decode(envoi({ retracts: uuid(1) }))).toEqual({ ok: false, error: { kind: 'UnknownField', field: 'fact' } });
      expect(decode({ ...without(envoi(), 'fact'), retracts: uuid(1), corrects: uuid(1) })).toEqual({ ok: false, error: { kind: 'UnknownField', field: 'corrects' } });
    });

    it("la déclaration nommée par une correction ou une annulation est un identifiant d'événement", () => {
      expect(decode(envoi({ corrects: 'la-precedente' }))).toEqual({ ok: false, error: { kind: 'InvalidId', expected: 'JournalEventId' } });
      expect(decode({ ...without(envoi(), 'fact'), retracts: null })).toEqual({ ok: false, error: { kind: 'InvalidId', expected: 'JournalEventId' } });
    });
  });

  describe('une pesée se lit sur la balance du site', () => {
    it("un poids au-delà de la balance du site, ou qui n'est pas un nombre entier de grammes, est refusé", () => {
      const pesee = (weights: unknown[]) => envoi({ fact: { type: 'Weighing', weighingRequestId: uuid(8), weights } });

      expect(decode(pesee([1820, 5_001]))).toEqual({ ok: false, error: { kind: 'WeightOutOfScale', grams: 5_001, capacityGrams: 5_000 } });
      expect(decode(pesee([1820.5]))).toEqual({ ok: false, error: { kind: 'InvalidWeight', grams: 1820.5 } });
    });

    it("une pesée sans aucun poids est refusée", () => {
      expect(decode(envoi({ fact: { type: 'Weighing', weighingRequestId: uuid(8), weights: [] } }))).toEqual({ ok: false, error: { kind: 'MalformedEvent', field: 'fact.weights' } });
    });

    it("une pesée sur un site dont la balance est inconnue est refusée : ses poids ne se jugent pas ; les autres faits de ce site passent", () => {
      const onUnknownScale = envoi({ siteId: SITE_WITHOUT_SCALE, fact: { type: 'Weighing', weighingRequestId: uuid(8), weights: [1820] } });

      expect(decode(onUnknownScale)).toEqual({ ok: false, error: { kind: 'ScaleUnknown' } });
      expect(decode(envoi({ siteId: SITE_WITHOUT_SCALE })).ok).toBe(true);
    });
  });
});
