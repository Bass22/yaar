import { unwrap } from '@kit';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BusinessDay } from './business-day';
import { CampaignId, JournalEventId, OrderLineId, SiteId, TaskId, TenantId, UserId } from './ids';
import { Instant } from './instant';
import { CounterDeclaration, Declaration, Retraction, type EventEnvelope, type Fact, type JournalEvent } from './journal-event';
import { computeLiveCount, mortality } from './live-count';
import { Quantity } from './quantity';

// Spec: Cahier des charges — « En-tête et contexte » (compteur de vivants) ; « Architecture des
// données » : les vivants partent des poussins réellement reçus, bonus compris ; une perte en
// poussins n'est pas une mort ; des morts supérieurs aux vivants sont acceptés.
// CLAUDE.md §4 règles 8 (projection), 9 (jamais bridé) et 10.

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const quantite = (count: number): Quantity => unwrap(Quantity(count));

const LA_BANDE = unwrap(CampaignId(uuid(4)));
const LA_BANDE_PRECEDENTE = unwrap(CampaignId(uuid(40)));
const LIGNE_POUSSINS = unwrap(OrderLineId(uuid(61)));
const LIGNE_ALIMENT = unwrap(OrderLineId(uuid(62)));

const recus = (count: number, orderLineId: OrderLineId = LIGNE_POUSSINS): Fact => ({
  type: 'Delivery',
  orderLineId,
  receivedQuantity: quantite(count),
  deliveryNote: { kind: 'NoPaper' },
});
const morts = (count: number): Fact => ({ type: 'Death', quantity: quantite(count) });
const manquants = (count: number): Fact => ({ type: 'Loss', lossType: 'Missing', quantity: quantite(count) });
const donnes = (count: number): Fact => ({ type: 'Loss', lossType: 'Donation', quantity: quantite(count) });
const voles = (count: number): Fact => ({ type: 'Loss', lossType: 'Theft', quantity: quantite(count) });

// The n-th event of the notebook, written n minutes after 18:00 on November 5th.
function signe(rank: number, overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    id: unwrap(JournalEventId(uuid(rank))),
    tenantId: unwrap(TenantId(uuid(2))),
    siteId: unwrap(SiteId(uuid(3))),
    campaignId: LA_BANDE,
    authorId: unwrap(UserId(uuid(51))),
    businessDate: unwrap(BusinessDay('2026-11-05')),
    recordedAt: unwrap(Instant(new Date(Date.UTC(2026, 10, 5, 18, rank)).toISOString())),
    ...overrides,
  };
}

const declare = (rank: number, fact: Fact, overrides: Partial<EventEnvelope> = {}): Declaration =>
  Declaration(signe(rank, overrides), fact);
const corrige = (rank: number, declaration: Declaration, fact: Fact): CounterDeclaration =>
  CounterDeclaration(signe(rank), declaration.id, fact);

const vivants = (journal: readonly JournalEvent[]) =>
  computeLiveCount(journal, { campaignId: LA_BANDE, placementOrderLines: [LIGNE_POUSSINS] });

describe('Vivants', () => {
  describe('les poussins réellement reçus', () => {
    it('les vivants valent les poussins réellement reçus moins les pertes déclarées', () => {
      // Given 510 poussins reçus, puis 3 morts et 2 morts
      const journal = [declare(1, recus(510)), declare(2, morts(3)), declare(3, morts(2))];

      // Then 510 − (3 + 2) = 505
      expect(vivants(journal)).toEqual({ received: 510, deaths: 5, losses: 0, sold: 0, liveCount: 505 });
    });

    it("un bonus de l'écloserie augmente les vivants, un manque à la réception les diminue : l'effectif commandé ne compte pas", () => {
      // Given une commande de 500 poussins : l'écloserie en livre 510, ou seulement 490
      expect(vivants([declare(1, recus(510))]).liveCount).toBe(510);
      expect(vivants([declare(1, recus(490))]).liveCount).toBe(490);
    });

    it('les réceptions partielles de poussins se cumulent', () => {
      // Then 300 + 210 = 510
      expect(vivants([declare(1, recus(300)), declare(2, recus(210))])).toMatchObject({ received: 510, liveCount: 510 });
    });

    it("une réception d'aliment ne met aucun poussin en place", () => {
      const journal = [declare(1, recus(510)), declare(2, recus(40, LIGNE_ALIMENT))];

      expect(vivants(journal)).toMatchObject({ received: 510, liveCount: 510 });
    });

    it("un cahier sans réception de poussins ne compte aucun animal reçu", () => {
      expect(vivants([])).toEqual({ received: 0, deaths: 0, losses: 0, sold: 0, liveCount: 0 });
    });

    it("seuls les événements de la campagne comptent : ceux de la bande précédente sont ignorés", () => {
      const journal = [
        declare(1, recus(510)),
        declare(2, morts(3)),
        declare(3, recus(480), { campaignId: LA_BANDE_PRECEDENTE }),
        declare(4, morts(9), { campaignId: LA_BANDE_PRECEDENTE }),
      ];

      // Then 510 − 3 = 507
      expect(vivants(journal)).toEqual({ received: 510, deaths: 3, losses: 0, sold: 0, liveCount: 507 });
    });
  });

  describe('morts et pertes hors mortalité', () => {
    it("chaque mort confirmé diminue les vivants d'autant", () => {
      const before = [declare(1, recus(510)), declare(2, morts(3))];

      // Then 507, puis 507 − 4 = 503
      expect(vivants(before).liveCount).toBe(507);
      expect(vivants([...before, declare(3, morts(4))]).liveCount).toBe(503);
    });

    it("des poussins manquants déclarés plus tard par l'admin diminuent les vivants sans réécrire la réception", () => {
      // Given 510 poussins reçus ; au recomptage il en manque 4
      const delivery = declare(1, recus(510));
      const journal = [delivery, declare(2, manquants(4))];

      // Then 510 − 4 = 506, et la réception dit toujours 510
      expect(vivants(journal)).toEqual({ received: 510, deaths: 0, losses: 4, sold: 0, liveCount: 506 });
      expect(delivery).toMatchObject({ receivedQuantity: 510 });
    });

    it('une perte hors mortalité diminue les vivants mais ne compte pas parmi les morts', () => {
      // Given 510 reçus, 5 morts, 4 manquants, 6 poulets donnés et 3 volés
      const journal = [declare(1, recus(510)), declare(2, morts(5)), declare(3, manquants(4)), declare(4, donnes(6)), declare(5, voles(3))];

      // Then morts = 5 ; pertes = 4 + 6 + 3 = 13 ; vivants = 510 − 5 − 13 = 492
      expect(vivants(journal)).toEqual({ received: 510, deaths: 5, losses: 13, sold: 0, liveCount: 492 });
    });

    // Spec: backlog W.1 — une vente retire les poulets vendus des vivants (décision du fondateur, 2026-11-12).
    it('les poulets vendus sortent des vivants, sans compter comme des pertes : 510 reçus, 5 morts, 200 vendus → 305', () => {
      const journal = [declare(1, recus(510)), declare(2, { type: 'Death', quantity: quantite(5) })];

      expect(computeLiveCount(journal, { campaignId: LA_BANDE, placementOrderLines: [LIGNE_POUSSINS], sold: 200 })).toEqual({ received: 510, deaths: 5, losses: 0, sold: 200, liveCount: 305 });
    });

    it("« rien perdu », une tâche faite ou un sac ouvert ne changent pas les vivants", () => {
      const journal = [
        declare(1, recus(510)),
        declare(2, { type: 'NoLoss' }),
        declare(3, { type: 'TaskDone', taskId: unwrap(TaskId(uuid(81))) }),
        declare(4, { type: 'BagOpened', quantity: quantite(2) }),
      ];

      expect(vivants(journal)).toEqual({ received: 510, deaths: 0, losses: 0, sold: 0, liveCount: 510 });
    });

    it('des morts déclarés supérieurs aux vivants sont acceptés : les vivants passent sous zéro, jamais bridés', () => {
      // Given 10 poussins reçus et 12 morts déclarés
      const journal = [declare(1, recus(10)), declare(2, morts(12))];

      // Then 10 − 12 = −2 : le signe dit de combien on dépasse
      expect(vivants(journal)).toEqual({ received: 10, deaths: 12, losses: 0, sold: 0, liveCount: -2 });
    });
  });

  describe('une projection du journal', () => {
    it('une correction compte à la place de la déclaration : 3 morts corrigés en 2, 510 reçus corrigés en 508', () => {
      // Given
      const delivery = declare(1, recus(510));
      const deaths = declare(2, morts(3));
      const journal = [delivery, deaths, corrige(3, deaths, morts(2)), corrige(4, delivery, recus(508))];

      // Then 508 − 2 = 506
      expect(vivants(journal)).toEqual({ received: 508, deaths: 2, losses: 0, sold: 0, liveCount: 506 });
    });

    it('une déclaration annulée ne compte plus : 3 morts annulés rendent 3 vivants', () => {
      // Given 510 reçus, 3 morts, puis l'admin annule ces 3 morts
      const deaths = declare(2, morts(3));
      const journal = [declare(1, recus(510)), deaths, Retraction(signe(3), deaths.id)];

      // Then 510 − 0 = 510
      expect(vivants(journal)).toEqual({ received: 510, deaths: 0, losses: 0, sold: 0, liveCount: 510 });
    });

    it('une réception de poussins annulée ne met plus aucun poussin en place', () => {
      // Given la même livraison saisie deux fois par erreur ; l'admin annule la seconde
      const twice = declare(2, recus(510));
      const journal = [declare(1, recus(510)), twice, Retraction(signe(3), twice.id)];

      expect(vivants(journal)).toMatchObject({ received: 510, liveCount: 510 });
    });

    it('rejouer deux fois le même événement ne change pas les vivants', () => {
      const journal = [declare(1, recus(510)), declare(2, morts(3))];

      expect(vivants([...journal, ...journal])).toEqual(vivants(journal));
    });

    it("le calcul ne modifie pas le journal qu'on lui donne", () => {
      const journal = [declare(2, morts(3)), declare(1, recus(510))];
      const before = JSON.stringify(journal);

      vivants(journal);

      expect(JSON.stringify(journal)).toBe(before);
    });

    // Up to twelve declarations of any kind that moves the count, or not, and their corrections.
    const aDeclaredFact = fc.oneof(
      fc.integer({ min: 1, max: 600 }).map((count) => recus(count)),
      fc.integer({ min: 1, max: 600 }).map((count) => recus(count, LIGNE_ALIMENT)),
      fc.integer({ min: 1, max: 40 }).map(morts),
      fc.integer({ min: 1, max: 40 }).map(manquants),
      fc.integer({ min: 1, max: 40 }).map(donnes),
      fc.integer({ min: 1, max: 40 }).map(voles),
      fc.constant<Fact>({ type: 'NoLoss' }),
    );
    const someDeclarations = fc
      .array(aDeclaredFact, { maxLength: 12 })
      .map((facts) => facts.map((fact, index) => declare(index + 1, fact)));

    it("pour tout journal, ni l'ordre d'arrivée ni les doublons ne changent les vivants (property-based)", () => {
      // Given des déclarations, dont certaines sont corrigées (même type, autre quantité)
      const aJournal = someDeclarations.chain((declarations) =>
        fc.array(fc.tuple(fc.nat({ max: 11 }), fc.integer({ min: 1, max: 40 })), { maxLength: 6 }).map((picks) => [
          ...declarations,
          ...picks.flatMap(([pick, count], rank) => {
            const declaration = declarations[pick];
            return declaration?.type === 'Death' ? [corrige(100 + rank, declaration, morts(count))] : [];
          }),
        ]),
      );
      // Every event arrives twice, in any order.
      const aJournalAndItsReplay = aJournal.chain((journal) =>
        fc.tuple(fc.constant(journal), fc.shuffledSubarray([...journal, ...journal], { minLength: journal.length * 2 })),
      );

      fc.assert(
        fc.property(aJournalAndItsReplay, ([journal, replayed]) => {
          expect(vivants(replayed)).toEqual(vivants(journal));
        }),
      );
    });

    it('pour tout journal sans correction, reçus, morts et pertes sont les sommes déclarées, et vivants = reçus − morts − pertes (property-based)', () => {
      const sum = (journal: readonly Declaration[], counts: (fact: Declaration) => number): number =>
        journal.reduce((total, declaration) => total + counts(declaration), 0);

      fc.assert(
        fc.property(someDeclarations, (journal) => {
          const received = sum(journal, (fact) =>
            fact.type === 'Delivery' && fact.orderLineId === LIGNE_POUSSINS ? fact.receivedQuantity : 0,
          );
          const deaths = sum(journal, (fact) => (fact.type === 'Death' ? fact.quantity : 0));
          const losses = sum(journal, (fact) => (fact.type === 'Loss' ? fact.quantity : 0));

          expect(vivants(journal)).toEqual({ received, deaths, losses, sold: 0, liveCount: received - deaths - losses });
        }),
      );
    });
  });

  // Spec: backlog V.3 ; cahier des charges « L'onglet Suivi d'un lot » — la mortalité
  describe('la mortalité', () => {
    it('vaut les morts ÷ les poussins reçus, au millième : 62 morts sur 1 000 = 0,062', () => {
      // Given 1 000 poussins reçus, 62 morts
      const journal = [declare(1, recus(1000)), declare(2, morts(62))];

      expect(mortality(vivants(journal))).toBe(0.062);
    });

    it('les pertes qui ne sont pas des morts et les ventes n’y comptent pas', () => {
      // Given 1 000 reçus, 10 morts, 30 manquants, 5 donnés, 2 volés, 400 vendus
      const journal = [declare(1, recus(1000)), declare(2, morts(10)), declare(3, manquants(30)), declare(4, donnes(5)), declare(5, voles(2))];
      const compte = computeLiveCount(journal, { campaignId: LA_BANDE, placementOrderLines: [LIGNE_POUSSINS], sold: 400 });

      // Then 10 ÷ 1 000 = 0,01
      expect(mortality(compte)).toBe(0.01);
    });

    it('s’arrondit au millième le plus proche : 1 mort sur 3 = 0,333 ; 2 sur 3 = 0,667', () => {
      expect(mortality(vivants([declare(1, recus(3)), declare(2, morts(1))]))).toBe(0.333);
      expect(mortality(vivants([declare(1, recus(3)), declare(2, morts(2))]))).toBe(0.667);
    });

    it('sans poussin reçu, la mortalité est absente, pas zéro — même avec des morts déclarés', () => {
      expect(mortality(vivants([]))).toBeNull();
      expect(mortality(vivants([declare(1, morts(3))]))).toBeNull();
    });

    it('zéro mort sur des poussins reçus : zéro, calculé', () => {
      expect(mortality(vivants([declare(1, recus(500))]))).toBe(0);
    });
  });
});
