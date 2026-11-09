import { unwrap } from '@kit';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BusinessDay } from './business-day';
import { lineDelivery, receivedByLine } from './delivery';
import { CampaignId, JournalEventId, OrderLineId, SiteId, TenantId, UserId } from './ids';
import { Instant } from './instant';
import { CounterDeclaration, Declaration, Retraction, type EventEnvelope, type Fact, type JournalEvent } from './journal-event';
import { Quantity } from './quantity';

// Spec: backlog Q.2 — réceptions partielles et écarts signés ; cahier des charges « Commandes »
// (réceptions partielles multiples, cumul par ligne, « reste N à venir »), « Livraison annoncée »
// (manque et bonus) ; CLAUDE.md §4 règles 8 (projection) et 9 (écarts signés, jamais bridés).
// Des quantités seules : ce code va sur le téléphone du gardien.

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const quantite = (count: number): Quantity => unwrap(Quantity(count));
const LIGNE_ALIMENT = unwrap(OrderLineId(uuid(61)));
const LIGNE_POUSSINS = unwrap(OrderLineId(uuid(62)));

const recus = (count: number, orderLineId: OrderLineId = LIGNE_ALIMENT): Fact => ({ type: 'Delivery', orderLineId, receivedQuantity: quantite(count), deliveryNote: { kind: 'NoPaper' } });

// The n-th event of the notebook, written n minutes after 08:00 on October 14th.
const signe = (rank: number, overrides: Partial<EventEnvelope> = {}): EventEnvelope => ({
  id: unwrap(JournalEventId(uuid(rank))),
  tenantId: unwrap(TenantId(uuid(2))),
  siteId: unwrap(SiteId(uuid(3))),
  campaignId: unwrap(CampaignId(uuid(4))),
  authorId: unwrap(UserId(uuid(51))),
  businessDate: unwrap(BusinessDay('2026-10-14')),
  recordedAt: unwrap(Instant(new Date(Date.UTC(2026, 9, 14, 8, rank)).toISOString())),
  ...overrides,
});
const declare = (rank: number, fact: Fact): Declaration => Declaration(signe(rank), fact);

describe('Les réceptions d’une commande', () => {
  describe('le reçu cumulé, ligne par ligne', () => {
    it('plusieurs réceptions se cumulent par ligne : 8 sacs, puis 12, font 20', () => {
      expect(receivedByLine([declare(1, recus(8)), declare(2, recus(12))]).get(LIGNE_ALIMENT)).toBe(20);
    });

    it('chaque ligne a son cumul ; ce qui n’est pas une réception n’y entre pas', () => {
      const journal = [declare(1, recus(8)), declare(2, recus(1000, LIGNE_POUSSINS)), declare(3, { type: 'Death', quantity: quantite(3) }), declare(4, { type: 'BagOpened', quantity: quantite(2) })];

      expect(receivedByLine(journal)).toEqual(
        new Map([
          [LIGNE_ALIMENT, 8],
          [LIGNE_POUSSINS, 1000],
        ]),
      );
    });

    it('une ligne qui n’a rien reçu n’a pas de cumul : absent n’est pas zéro', () => {
      expect(receivedByLine([declare(1, recus(8))]).has(LIGNE_POUSSINS)).toBe(false);
    });

    it('une réception corrigée compte pour sa nouvelle valeur ; une réception annulée ne compte plus', () => {
      const douze = declare(2, recus(12));
      const journal = [declare(1, recus(8)), douze, CounterDeclaration(signe(3), douze.id, recus(10)), Retraction(signe(5), declare(4, recus(30)).id), declare(4, recus(30))];

      expect(receivedByLine(journal).get(LIGNE_ALIMENT)).toBe(18);
    });

    it('le reçu cumulé est la somme des réceptions, quels que soient leur ordre d’arrivée et leurs doublons (property-based)', () => {
      const aJournal = fc
        .array(fc.tuple(fc.integer({ min: 1, max: 500 }), fc.boolean()), { maxLength: 12 })
        .map((deliveries) => deliveries.map(([count, poussins], index) => declare(index + 1, recus(count, poussins ? LIGNE_POUSSINS : LIGNE_ALIMENT))));
      const aJournalAndItsReplay = aJournal.chain((journal) => fc.tuple(fc.constant(journal), fc.shuffledSubarray([...journal, ...journal], { minLength: journal.length * 2 })));

      fc.assert(
        fc.property(aJournalAndItsReplay, ([journal, replayed]) => {
          const sumOf = (line: OrderLineId) => journal.reduce((total, event) => total + (event.type === 'Delivery' && event.orderLineId === line ? event.receivedQuantity : 0), 0);
          const received = receivedByLine(replayed as readonly JournalEvent[]);

          expect([received.get(LIGNE_ALIMENT) ?? 0, received.get(LIGNE_POUSSINS) ?? 0]).toEqual([sumOf(LIGNE_ALIMENT), sumOf(LIGNE_POUSSINS)]);
        }),
      );
    });
  });

  describe('l’état d’une ligne : reste à venir, écart signé, complète', () => {
    it('reçu en partie : il reste la quantité commandée moins le reçu ; l’écart est un manque, négatif ; pas complète', () => {
      // 40 sacs commandés, 30 reçus : reste 10, écart −10
      expect(lineDelivery(quantite(40), 30)).toEqual({ ordered: 40, received: 30, remaining: 10, variance: -10, complete: false });
    });

    it('rien reçu : tout reste à venir, et le manque est la commande entière', () => {
      expect(lineDelivery(quantite(40), 0)).toEqual({ ordered: 40, received: 0, remaining: 40, variance: -40, complete: false });
    });

    it('reçu juste : rien ne reste, aucun écart, complète', () => {
      expect(lineDelivery(quantite(1000), 1000)).toEqual({ ordered: 1000, received: 1000, remaining: 0, variance: 0, complete: true });
    });

    it('un bonus est un écart positif, jamais ramené à zéro ; le reste à venir, lui, ne descend pas sous zéro', () => {
      // 1 000 poussins commandés, 1 050 reçus : le cas des écloseries
      expect(lineDelivery(quantite(1000), 1050)).toEqual({ ordered: 1000, received: 1050, remaining: 0, variance: 50, complete: true });
    });

    it('pour toute commande et tout reçu : écart = reçu − commandé ; reste = max(0, −écart) ; complète si et seulement si rien ne reste (property-based)', () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 5000 }), fc.integer({ min: 0, max: 10000 }), (ordered, received) => {
          const line = lineDelivery(quantite(ordered), received);

          expect(line.variance).toBe(received - ordered);
          expect(line.remaining).toBe(Math.max(0, ordered - received));
          expect(line.complete).toBe(line.remaining === 0);
        }),
      );
    });
  });
});
