import { unwrap } from '@kit';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addDays, BusinessDay } from './business-day';
import { feedConsumption, BAG_WEIGHT, type SoldBirds } from './feed-consumption';
import { CampaignId, JournalEventId, OrderLineId, SiteId, TenantId, UserId, WeighingRequestId } from './ids';
import { Instant } from './instant';
import { CounterDeclaration, Declaration, Retraction, type EventEnvelope, type Fact, type JournalEvent } from './journal-event';
import { Quantity } from './quantity';
import { STRAINS, targetAt } from './strain';
import { Weight } from './weight';

// Spec: backlog V.1 — la consommation d'aliment ; cahier des charges « La consommation d'aliment »
// (décisions du fondateur du 2026-11-12 : un sac pèse 50 kg ; le cumul par poulet est la somme des
// jours, chaque jour divisé par ses vivants ; pas de chiffre par jour ; l'indice sur la dernière
// pesée validée, absent sans elle). Les nombres attendus sont calculés à la main en commentaire.

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const quantite = (count: number): Quantity => unwrap(Quantity(count));
const COBB = STRAINS[0]!;
const LA_BANDE = unwrap(CampaignId(uuid(4)));
const UNE_AUTRE_BANDE = unwrap(CampaignId(uuid(40)));
const LIGNE_POUSSINS = unwrap(OrderLineId(uuid(61)));
const LIGNE_ALIMENT = unwrap(OrderLineId(uuid(62)));
const DEMANDE = unwrap(WeighingRequestId(uuid(70)));
// The flock is placed on Monday October 12th, 2026: day J0.
const MISE_EN_PLACE = unwrap(BusinessDay('2026-10-12'));
const jour = (campaignDay: number): BusinessDay => addDays(MISE_EN_PLACE, campaignDay);

const recus = (count: number, orderLineId: OrderLineId = LIGNE_POUSSINS): Fact => ({ type: 'Delivery', orderLineId, receivedQuantity: quantite(count), deliveryNote: { kind: 'NoPaper' } });
const sacs = (count: number): Fact => ({ type: 'BagOpened', quantity: quantite(count) });
const morts = (count: number): Fact => ({ type: 'Death', quantity: quantite(count) });
const manquants = (count: number): Fact => ({ type: 'Loss', lossType: 'Missing', quantity: quantite(count) });
const pesee = (...weights: number[]): Fact => ({ type: 'Weighing', weighingRequestId: DEMANDE, weights: weights.map((grams) => unwrap(Weight(grams))) });

// The n-th event of the notebook, on day J`campaignDay`, written n minutes after 18:00 that day.
const signe = (rank: number, campaignDay: number, overrides: Partial<EventEnvelope> = {}): EventEnvelope => ({
  id: unwrap(JournalEventId(uuid(rank))),
  tenantId: unwrap(TenantId(uuid(2))),
  siteId: unwrap(SiteId(uuid(3))),
  campaignId: LA_BANDE,
  authorId: unwrap(UserId(uuid(51))),
  businessDate: jour(campaignDay),
  recordedAt: unwrap(Instant(`${jour(campaignDay)}T18:${String(rank % 60).padStart(2, '0')}:00.000Z`)),
  ...overrides,
});
const declare = (rank: number, campaignDay: number, fact: Fact, overrides: Partial<EventEnvelope> = {}): Declaration => Declaration(signe(rank, campaignDay, overrides), fact);
const valide = (rank: number, campaignDay: number, weighing: Declaration, campaignId: CampaignId = LA_BANDE): Declaration => declare(rank, campaignDay, { type: 'WeighingValidated', weighingId: weighing.id }, { campaignId });

const conso = (journal: readonly JournalEvent[], today: number, sold: readonly SoldBirds[] = []) =>
  feedConsumption(journal, { campaignId: LA_BANDE, placementDay: MISE_EN_PLACE, today: jour(today), placementOrderLines: [LIGNE_POUSSINS], sold, strain: COBB });

describe("La consommation d'aliment", () => {
  it('un sac pèse 50 kg', () => {
    expect(BAG_WEIGHT).toBe(50_000);
  });

  describe('le sac entamé laissé à la clôture (X.2, décision du 2026-11-12)', () => {
    // 1 000 poussins à J0 ; 2 sacs à J1 ; 100 morts à J2 ; 1 sac à J3, le dernier ouvert
    const journal = [declare(1, 0, recus(1000)), declare(2, 1, sacs(2)), declare(3, 2, morts(100)), declare(4, 3, sacs(1))];
    const close = (openedFeedBagsLeft: number, today = 5) =>
      feedConsumption(journal, { campaignId: LA_BANDE, placementDay: MISE_EN_PLACE, today: jour(today), placementOrderLines: [LIGNE_POUSSINS], sold: [], strain: COBB, openedFeedBagsLeft });

    it('sa moitié restante, 25 kg, sort du dernier jour où un sac a été ouvert', () => {
      // Sans lui : J1 100 000 ÷ 1 000 = 100 ; J3 50 000 ÷ 900 = 55,56 → 156 g
      expect(close(0).cumulative).toBe(156);
      // Avec un sac entamé : J3 (50 000 − 25 000) ÷ 900 = 27,78 → 100 + 27,78 = 128 g
      expect(close(1).cumulative).toBe(128);
    });

    it('les sacs restent comptés tels que déclarés', () => {
      expect(close(1).bagsOpened).toBe(3);
    });

    it('un jour avant le dernier sac ouvert n’est pas touché (l’indice d’une pesée de J2)', () => {
      const avecPesee = [...journal, declare(5, 2, pesee(200, 200, 200, 200, 200))];
      const validee = valide(6, 2, avecPesee.at(-1) as Declaration);
      const conso = feedConsumption([...avecPesee, validee], { campaignId: LA_BANDE, placementDay: MISE_EN_PLACE, today: jour(5), placementOrderLines: [LIGNE_POUSSINS], sold: [], strain: COBB, openedFeedBagsLeft: 1 });

      // J2 : 100 g pour 200 g = 0,5, comme sans le sac entamé
      expect(conso.feedConversion?.value).toBe(0.5);
    });
  });

  describe('le cumul par poulet', () => {
    it('vaut les sacs ouverts × 50 kg ÷ les vivants : à J0, 1 sac pour 1 000 poussins = 50 g par poulet', () => {
      // Given 1 000 poussins reçus et 1 sac ouvert le jour de la mise en place
      const journal = [declare(1, 0, recus(1000)), declare(2, 0, sacs(1))];

      // When on calcule la consommation à J0
      // Then 50 000 g ÷ 1 000 = 50 g
      expect(conso(journal, 0)).toMatchObject({ bagsOpened: 1, cumulative: 50 });
    });

    it('avec un effectif qui baisse, chaque jour se divise par ses vivants, puis on additionne', () => {
      // Given 1 000 poussins à J0 ; 1 sac à J0, 1 sac à J1, 200 morts à J1, 1 sac à J2
      const journal = [declare(1, 0, recus(1000)), declare(2, 0, sacs(1)), declare(3, 1, sacs(1)), declare(4, 1, morts(200)), declare(5, 2, sacs(1))];

      // Then J0 : 50 000 ÷ 1 000 = 50 ; J1 : les morts de J1 comptent à partir de J2, 50 000 ÷ 1 000 = 50 ;
      // J2 : 50 000 ÷ 800 = 62,5 ; cumul 162,5 → 163 g (et non 150 000 ÷ 800 = 187,5 : l'aliment des morts n'est pas chargé aux survivants)
      expect(conso(journal, 2).cumulative).toBe(163);
    });

    it('les pertes et les ventes des jours d’avant diminuent les vivants aussi', () => {
      // Given 1 000 poussins à J0 ; 100 manquants à J10 ; 400 vendus à J11 ; 1 sac à J10, 1 sac à J11, 1 sac à J12
      const journal = [declare(1, 0, recus(1000)), declare(2, 10, manquants(100)), declare(3, 10, sacs(1)), declare(4, 11, sacs(1)), declare(5, 12, sacs(1))];
      const vendus: SoldBirds[] = [{ soldOn: jour(11), quantity: 400 }];

      // Then J10 : 50 000 ÷ 1 000 = 50 ; J11 : 50 000 ÷ 900 = 55,56 ; J12 : 50 000 ÷ 500 = 100 ; cumul 205,56 → 206 g
      expect(conso(journal, 12, vendus).cumulative).toBe(206);
    });

    it('le jour de la mise en place, les sacs se divisent par les poussins reçus ce jour-là ; une seconde livraison compte dès son jour', () => {
      // Given 600 poussins à J0, 400 à J1 ; 1 sac à J0 et 1 sac à J1
      const journal = [declare(1, 0, recus(600)), declare(2, 1, recus(400)), declare(3, 0, sacs(1)), declare(4, 1, sacs(1))];

      // Then J0 : 50 000 ÷ 600 = 83,33 ; J1 : 50 000 ÷ 1 000 = 50 ; cumul 133,33 → 133 g
      expect(conso(journal, 1).cumulative).toBe(133);
    });

    it('le journal tel qu’il compte : une correction remplace les sacs déclarés, une annulation les retire', () => {
      // Given 1 000 poussins ; 3 sacs à J1 corrigés en 1 ; 2 sacs à J2 annulés par l'admin
      const trois = declare(2, 1, sacs(3));
      const deux = declare(3, 2, sacs(2));
      const journal = [declare(1, 0, recus(1000)), trois, CounterDeclaration(signe(4, 1), trois.id, sacs(1)), deux, Retraction(signe(5, 2), deux.id)];

      // Then 1 sac seulement : 50 000 ÷ 1 000 = 50 g
      expect(conso(journal, 2)).toMatchObject({ bagsOpened: 1, cumulative: 50 });
    });

    it('seuls les poussins comptent dans les vivants : une livraison d’aliment n’en est pas', () => {
      const journal = [declare(1, 0, recus(1000)), declare(2, 0, recus(40, LIGNE_ALIMENT)), declare(3, 0, sacs(1))];

      expect(conso(journal, 0).cumulative).toBe(50);
    });

    it('les sacs et les poussins d’une autre bande ne comptent pas', () => {
      const journal = [declare(1, 0, recus(1000)), declare(2, 0, sacs(1)), declare(3, 0, sacs(5), { campaignId: UNE_AUTRE_BANDE }), declare(4, 0, recus(9000), { campaignId: UNE_AUTRE_BANDE })];

      expect(conso(journal, 0)).toMatchObject({ bagsOpened: 1, cumulative: 50 });
    });
  });

  describe('absent n’est pas zéro', () => {
    it('tant qu’aucun poussin n’est reçu, le cumul est absent, même avec des sacs ouverts', () => {
      expect(conso([declare(1, 0, sacs(2))], 0)).toMatchObject({ bagsOpened: 2, cumulative: null, variance: null });
    });

    it('les sacs d’un jour sans vivants connus ne se divisent par rien : ils ne comptent pas dans le cumul', () => {
      // Given 1 sac à J0, les poussins reçus à J1 seulement, 1 sac à J1
      const journal = [declare(1, 0, sacs(1)), declare(2, 1, recus(1000)), declare(3, 1, sacs(1))];

      // Then seul le sac de J1 compte : 50 000 ÷ 1 000 = 50 g ; les deux sacs restent comptés comme ouverts
      expect(conso(journal, 1)).toMatchObject({ bagsOpened: 2, cumulative: 50 });
    });

    it('des poussins reçus sans sac ouvert : le cumul est zéro, calculé sur un effectif connu', () => {
      expect(conso([declare(1, 0, recus(1000))], 0).cumulative).toBe(0);
    });
  });

  describe('face à la table de la souche, au même âge', () => {
    it('à J7, 150 g par poulet contre 140 g dans la table Cobb 500 : écart signé de +10 g', () => {
      // Given 1 000 poussins ; 3 sacs ouverts sur la première semaine
      const journal = [declare(1, 0, recus(1000)), declare(2, 2, sacs(1)), declare(3, 4, sacs(1)), declare(4, 6, sacs(1))];

      // Then 3 × 50 000 ÷ 1 000 = 150 g ; la table donne 140 g de cumul à J7 ; 150 − 140 = +10
      expect(targetAt(COBB, 7)?.cumulativeFeed).toBe(140);
      expect(conso(journal, 7)).toMatchObject({ cumulative: 150, target: 140, variance: 10 });
    });

    it('moins que la table : l’écart est négatif, jamais bridé', () => {
      const journal = [declare(1, 0, recus(1000)), declare(2, 3, sacs(1))];

      // Then 50 − 140 = −90
      expect(conso(journal, 7)).toMatchObject({ cumulative: 50, target: 140, variance: -90 });
    });

    it('avant J7 la table ne donne pas de cumul : la cible et l’écart sont absents', () => {
      const journal = [declare(1, 0, recus(1000)), declare(2, 3, sacs(1))];

      expect(conso(journal, 6)).toMatchObject({ cumulative: 50, target: null, variance: null });
    });

    it('au-delà de J49, hors de la table : la cible et l’écart sont absents', () => {
      const journal = [declare(1, 0, recus(1000)), declare(2, 3, sacs(1))];

      expect(conso(journal, 50)).toMatchObject({ cumulative: 50, target: null, variance: null });
    });

    it('sans souche connue, pas de cible ni d’indice du guide', () => {
      const premiere = declare(3, 14, pesee(600, 600, 600, 600, 600));
      const journal = [declare(1, 0, recus(1000)), declare(2, 3, sacs(1)), premiere, valide(4, 14, premiere)];

      const sansSouche = feedConsumption(journal, { campaignId: LA_BANDE, placementDay: MISE_EN_PLACE, today: jour(14), placementOrderLines: [LIGNE_POUSSINS], sold: [], strain: null });

      expect(sansSouche).toMatchObject({ cumulative: 50, target: null, variance: null, feedConversion: { campaignDay: 14, value: 0.083, target: null } });
    });
  });

  describe("l'indice de consommation", () => {
    it('sans pesée validée, l’indice est absent, pas zéro — une pesée pas encore validée ne compte pas', () => {
      const pasValidee = declare(3, 14, pesee(600, 600, 600, 600, 600));
      const journal = [declare(1, 0, recus(1000)), declare(2, 3, sacs(4)), pasValidee];

      expect(conso(journal, 14).feedConversion).toBeNull();
    });

    it('vaut le cumul par poulet jusqu’au jour de la dernière pesée validée ÷ son poids moyen, face à l’indice du guide ce jour-là', () => {
      // Given 1 000 poussins ; 2 sacs à J0, 4 à J7, 4 à J14, 10 à J15 ;
      // une pesée validée à J7 (180 g), une autre à J14 (600 g), une à J15 pas validée
      const j7 = declare(10, 7, pesee(180, 180, 180, 180, 180));
      const j14 = declare(11, 14, pesee(580, 620, 590, 610, 600));
      const j15 = declare(12, 15, pesee(700, 700, 700, 700, 700));
      const journal = [declare(1, 0, recus(1000)), declare(2, 0, sacs(2)), declare(3, 7, sacs(4)), declare(4, 14, sacs(4)), declare(5, 15, sacs(10)), j7, valide(13, 7, j7), j14, valide(14, 14, j14), j15];

      // Then jusqu'à J14 compris : 10 sacs × 50 000 ÷ 1 000 = 500 g ; moyenne (580 + 620 + 590 + 610 + 600) ÷ 5 = 600 g ;
      // indice 500 ÷ 600 = 0,8333 → 0,833 ; le guide donne 1,059 à J14. Le cumul d'aujourd'hui (J15) compte les 10 sacs de plus : 1 000 g
      expect(conso(journal, 15)).toMatchObject({ cumulative: 1000, feedConversion: { campaignDay: 14, value: 0.833, target: 1.059 } });
    });

    it('la pesée validée d’une autre bande ne sert pas à l’indice', () => {
      // Given notre bande pesée et validée à J7 (180 g) ; une autre bande pesée et validée plus tard, à J14
      const notre = declare(10, 7, pesee(180, 180, 180, 180, 180));
      const autre = declare(11, 14, pesee(900, 900, 900, 900, 900), { campaignId: UNE_AUTRE_BANDE });
      const journal = [declare(1, 0, recus(1000)), declare(2, 0, sacs(2)), notre, valide(12, 7, notre), autre, valide(13, 14, autre, UNE_AUTRE_BANDE)];

      // Then l'indice est celui de J7 : 2 × 50 000 ÷ 1 000 = 100 g ÷ 180 g = 0,5556 → 0,556
      expect(conso(journal, 15).feedConversion).toEqual({ campaignDay: 7, value: 0.556, target: 0.856 });
    });

    it('sans poussin reçu, pas d’indice : le cumul jusqu’à la pesée est absent', () => {
      const j14 = declare(11, 14, pesee(600, 600, 600, 600, 600));

      expect(conso([declare(2, 3, sacs(4)), j14, valide(12, 14, j14)], 14).feedConversion).toBeNull();
    });
  });

  it('ni l’ordre d’arrivée ni un événement reçu deux fois ne changent la consommation', () => {
    const j14 = declare(11, 14, pesee(580, 620, 590, 610, 600));
    const journal: JournalEvent[] = [declare(1, 0, recus(1000)), declare(2, 0, sacs(2)), declare(3, 5, morts(30)), declare(4, 7, sacs(4)), declare(5, 9, sacs(3)), declare(6, 14, sacs(4)), j14, valide(12, 14, j14)];
    const attendu = conso(journal, 15);

    fc.assert(
      fc.property(fc.shuffledSubarray(journal, { minLength: journal.length, maxLength: journal.length }), fc.subarray(journal), (melange, doublons) => {
        expect(conso([...melange, ...doublons], 15)).toEqual(attendu);
      }),
    );
  });
});
