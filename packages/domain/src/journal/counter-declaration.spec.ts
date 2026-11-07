import { unwrap } from '@kit';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BusinessDay, TimeZone } from './business-day';
import type { Campaign } from './campaign';
import { effectiveJournal, validateCounterDeclaration } from './counter-declaration';
import { authorizeDeclaration } from './declaration-policy';
import { CampaignId, JournalEventId, OrderLineId, SiteId, TaskId, TenantId, UserId, WeighingRequestId } from './ids';
import { Instant } from './instant';
import {
  CounterDeclaration,
  Declaration,
  type DeliveryNote,
  type EventEnvelope,
  type Fact,
  type JournalEvent,
} from './journal-event';
import { MediaFingerprint } from './media-fingerprint';
import { Quantity } from './quantity';
import type { Role } from './role';
import { Weight } from './weight';

// Spec: Cahier des charges — « Corrections » : après envoi, uniquement par contre-déclaration
// tracée et en ligne, jamais d'effacement ; même objet, seules les valeurs mesurées changent ;
// trois jours pour le gardien et dernière écrite qui fait foi, d'après la date de saisie.
// CLAUDE.md §4 règles 1 à 3.

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const eventId = (rank: number): JournalEventId => unwrap(JournalEventId(uuid(rank)));
const jour = (iso: string): BusinessDay => unwrap(BusinessDay(iso));
const instant = (iso: string): Instant => unwrap(Instant(iso));
const empreinte = (digit: string): MediaFingerprint => unwrap(MediaFingerprint(digit.repeat(64)));

const morts = (count: number): Fact => ({ type: 'Death', quantity: unwrap(Quantity(count)) });
const sacs = (count: number): Fact => ({ type: 'BagOpened', quantity: unwrap(Quantity(count)) });
const PAPIER_PHOTOGRAPHIE: DeliveryNote = { kind: 'Photographed', media: empreinte('a') };
const PAS_DE_PAPIER: DeliveryNote = { kind: 'NoPaper' };
const recu = (count: number, orderLine = 61, deliveryNote: DeliveryNote = PAPIER_PHOTOGRAPHIE): Fact => ({
  type: 'Delivery',
  orderLineId: unwrap(OrderLineId(uuid(orderLine))),
  receivedQuantity: unwrap(Quantity(count)),
  deliveryNote,
});
const pesee = (grams: readonly number[], request = 71): Fact => ({
  type: 'Weighing',
  weighingRequestId: unwrap(WeighingRequestId(uuid(request))),
  weights: grams.map((weight) => unwrap(Weight(weight, { capacityGrams: 5_000 }))),
});
const tacheFaite = (task = 81): Fact => ({ type: 'TaskDone', taskId: unwrap(TaskId(uuid(task))) });
const vocal = (digit = 'b'): Fact => ({ type: 'VoiceMessage', media: empreinte(digit) });
const photo = (digit = 'c'): Fact => ({ type: 'Photo', media: empreinte(digit) });

const OUSMANE = unwrap(UserId(uuid(51)));
const AWA = unwrap(UserId(uuid(52)));
const LE_GERANT = unwrap(UserId(uuid(54)));
const DAKAR = unwrap(TimeZone('Africa/Dakar')); // UTC+0

// Everything is written in the notebook of the same site, for the same campaign.
function signe(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    id: eventId(1),
    tenantId: unwrap(TenantId(uuid(2))),
    siteId: unwrap(SiteId(uuid(3))),
    campaignId: unwrap(CampaignId(uuid(4))),
    authorId: OUSMANE,
    businessDate: jour('2026-11-05'),
    recordedAt: instant('2026-11-05T18:30:00.000Z'),
    ...overrides,
  };
}

function uneCampagneEnCours(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: unwrap(CampaignId(uuid(4))),
    siteId: unwrap(SiteId(uuid(3))),
    placementDay: jour('2026-10-15'),
    closedAt: null,
    ...overrides,
  };
}

// Ousmane declares on November 5th at 18:30: three deaths, unless said otherwise.
const declare = (fact: Fact): Declaration => Declaration(signe(), fact);
const troisMortsDOusmane = (): Declaration => declare(morts(3));

// A counter-declaration of that declaration, which Awa's phone stamps 19:00 the same evening.
function corrige(fact: Fact, overrides: Partial<EventEnvelope> = {}, target = eventId(1)): CounterDeclaration {
  return CounterDeclaration(
    signe({ id: eventId(100), authorId: AWA, recordedAt: instant('2026-11-05T19:00:00.000Z'), ...overrides }),
    target,
    fact,
  );
}

type Judgement = { readonly authorRole?: Role; readonly campaign?: Campaign };
// The author of the correction judged, with the role the session gives them.

const juge = (
  counter: CounterDeclaration,
  corrected: JournalEvent,
  { authorRole = 'collaborator', campaign = uneCampagneEnCours() }: Judgement = {},
) => validateCounterDeclaration(counter, { corrected, correctedIsRetracted: false, campaign, timeZone: DAKAR, author: { id: counter.authorId, role: authorRole } });

describe('Contre-déclaration', () => {
  describe('une correction tracée', () => {
    it("une contre-déclaration est un événement signé qui nomme la déclaration qu'elle corrige", () => {
      // When Awa corrige les trois morts d'Ousmane en deux
      const counter = corrige(morts(2));

      // Then
      expect(counter).toEqual({ ...signe(), id: uuid(100), authorId: AWA, recordedAt: '2026-11-05T19:00:00.000Z', corrects: uuid(1), type: 'Death', quantity: 2 });
      expect(juge(counter, troisMortsDOusmane())).toEqual({ ok: true, value: counter });
    });

    it("une contre-déclaration construite ne peut plus être modifiée, et n'emporte aucun champ hors du schéma", () => {
      // Given
      const smuggled = { ...morts(2), cause: 'chaleur' };

      // When
      const counter = corrige(smuggled);

      // Then
      expect(Object.isFrozen(counter)).toBe(true);
      expect(counter).not.toHaveProperty('cause');
      expect(() => {
        (counter as { corrects: JournalEventId }).corrects = eventId(9);
      }).toThrow(TypeError);
    });

    it("une déclaration ne corrige rien : seule une contre-déclaration nomme un autre événement", () => {
      expect(troisMortsDOusmane()).not.toHaveProperty('corrects');
    });

    it("une contre-déclaration porte un fait du journal : rien d'autre, pas même une annulation", () => {
      const retraction = { type: 'Retraction' } as unknown as Fact;

      expect(() => corrige(retraction)).toThrow(TypeError);
    });
  });

  describe('même cahier, même jour, même type', () => {
    it("une contre-déclaration référence un événement du même site et de la même campagne", () => {
      // Given une correction écrite dans le cahier d'un autre site, puis d'une autre campagne, puis d'un autre élevage
      const elsewhere: Partial<EventEnvelope>[] = [
        { siteId: unwrap(SiteId(uuid(30))) },
        { campaignId: unwrap(CampaignId(uuid(40))) },
        { tenantId: unwrap(TenantId(uuid(20))) },
      ];

      for (const overrides of elsewhere) {
        expect(juge(corrige(morts(2), overrides), troisMortsDOusmane())).toEqual({
          ok: false,
          error: { kind: 'CorrectsEventElsewhere' },
        });
      }
    });

    it('une contre-déclaration ne déplace pas la déclaration vers un autre jour', () => {
      const counter = corrige(morts(2), { businessDate: jour('2026-11-04') });

      expect(juge(counter, troisMortsDOusmane())).toEqual({ ok: false, error: { kind: 'CorrectionChangesBusinessDate' } });
    });

    it("une contre-déclaration ne change pas le type : des morts ne deviennent pas des sacs", () => {
      expect(juge(corrige(sacs(2)), troisMortsDOusmane())).toEqual({ ok: false, error: { kind: 'CorrectionChangesType' } });
    });

    it("une contre-déclaration vise la déclaration d'origine, jamais une autre contre-déclaration", () => {
      // Given une première correction, puis une seconde qui vise la première au lieu de l'origine
      const first = corrige(morts(2));
      const second = corrige(morts(1), { id: eventId(101) }, first.id);

      // Then
      expect(juge(second, first)).toEqual({ ok: false, error: { kind: 'CorrectsACounterDeclaration' } });
    });

    it("une contre-déclaration ne porte pas l'identifiant de la déclaration qu'elle corrige", () => {
      // Given un téléphone qui réutilise l'identifiant de la déclaration : le serveur l'ignorerait comme doublon
      const sameId = corrige(morts(2), { id: eventId(1) });

      expect(juge(sameId, troisMortsDOusmane())).toEqual({ ok: false, error: { kind: 'CorrectsItself' } });
    });

    it("juger une contre-déclaration contre un autre événement que celui qu'elle nomme est une panne", () => {
      const another = Declaration(signe({ id: eventId(7) }), morts(3));

      expect(() => juge(corrige(morts(2)), another)).toThrow(TypeError);
    });
  });

  describe('même objet : seules les valeurs mesurées changent', () => {
    it('une correction de réception change la quantité reçue et le papier du livreur', () => {
      // Given 50 sacs reçus avec le papier ; il y en avait 48, et la photo n'était pas celle du papier
      const counter = corrige(recu(48, 61, PAS_DE_PAPIER));

      expect(juge(counter, declare(recu(50)))).toEqual({ ok: true, value: counter });
    });

    it("une correction de réception ne déplace pas la réception vers une autre ligne de commande", () => {
      expect(juge(corrige(recu(50, 62)), declare(recu(50, 61)))).toEqual({
        ok: false,
        error: { kind: 'CorrectionChangesReference' },
      });
    });

    it("une correction de pesée change les poids, pas la demande de pesée à laquelle elle répond", () => {
      const weighing = declare(pesee([1_250, 1_300, 1_180, 1_420, 1_350]));
      const reweighed = corrige(pesee([1_250, 1_300, 1_180, 1_240, 1_350]));
      const otherRequest = corrige(pesee([1_250, 1_300, 1_180, 1_420, 1_350], 72));

      expect(juge(reweighed, weighing)).toEqual({ ok: true, value: reweighed });
      expect(juge(otherRequest, weighing)).toEqual({ ok: false, error: { kind: 'CorrectionChangesReference' } });
    });

    it("une correction de perte hors mortalité change la quantité, pas le type de perte : des manquants ne deviennent pas des dons", () => {
      const missing = declare({ type: 'Loss', lossType: 'Missing', quantity: unwrap(Quantity(4)) });
      const fewer = corrige({ type: 'Loss', lossType: 'Missing', quantity: unwrap(Quantity(3)) });
      const donated = corrige({ type: 'Loss', lossType: 'Donation', quantity: unwrap(Quantity(4)) });

      expect(juge(fewer, missing, { authorRole: 'admin' })).toEqual({ ok: true, value: fewer });
      expect(juge(donated, missing, { authorRole: 'admin' })).toEqual({ ok: false, error: { kind: 'CorrectionChangesReference' } });
    });

    it("une tâche faite ne devient pas une autre tâche ; un vocal ou une photo ne se remplace pas", () => {
      const swaps: [declared: Fact, corrected: Fact][] = [
        [tacheFaite(81), tacheFaite(82)],
        [vocal('b'), vocal('d')],
        [photo('c'), photo('d')],
      ];

      for (const [declared, corrected] of swaps) {
        expect(juge(corrige(corrected), declare(declared))).toEqual({
          ok: false,
          error: { kind: 'CorrectionChangesReference' },
        });
      }
    });
  });

  describe('jugée à sa date de saisie, comme une déclaration', () => {
    it("le gardien corrige les trois jours de son cahier, pas au-delà ; l'admin corrige encore", () => {
      // Given des morts déclarés pour le 5 novembre
      const le7AuSoir = corrige(morts(2), { recordedAt: instant('2026-11-07T23:00:00.000Z') });
      const le8ApresMinuit = corrige(morts(2), { recordedAt: instant('2026-11-08T00:30:00.000Z') });
      const le20 = corrige(morts(2), { recordedAt: instant('2026-11-20T08:00:00.000Z') });

      // Then le 7 au soir le 5 est encore avant-hier ; le 8 à 0 h 30 il ne l'est plus
      expect(juge(le7AuSoir, troisMortsDOusmane()).ok).toBe(true);
      expect(juge(le8ApresMinuit, troisMortsDOusmane())).toEqual({ ok: false, error: { kind: 'CatchUpWindowPassed' } });
      expect(juge(le20, troisMortsDOusmane(), { authorRole: 'admin' }).ok).toBe(true);
    });

    it('une correction écrite après la clôture de la campagne est refusée', () => {
      // Given une campagne clôturée le 6 novembre à midi
      const campaign = uneCampagneEnCours({ closedAt: instant('2026-11-06T12:00:00.000Z') });
      const avantLaCloture = corrige(morts(2), { recordedAt: instant('2026-11-06T11:00:00.000Z') });
      const apresLaCloture = corrige(morts(2), { recordedAt: instant('2026-11-06T13:00:00.000Z') });

      // Then
      expect(juge(avantLaCloture, troisMortsDOusmane(), { campaign }).ok).toBe(true);
      expect(juge(apresLaCloture, troisMortsDOusmane(), { campaign })).toEqual({ ok: false, error: { kind: 'CampaignClosed' } });
    });

    it('en mode strict, un remplaçant ne corrige pas plus qu’il ne déclare', () => {
      const site = { siteId: unwrap(SiteId(uuid(3))), primaryCaretaker: OUSMANE, substitutes: [AWA], strictMode: true };

      expect(authorizeDeclaration(corrige(morts(2)), { author: { id: AWA, role: 'collaborator' }, site })).toEqual({
        ok: false,
        error: { kind: 'StrictModePrimaryOnly' },
      });
    });
  });

  describe('le journal effectif', () => {
    it("sans correction, une déclaration compte telle qu'elle a été écrite", () => {
      const declaration = troisMortsDOusmane();

      expect(effectiveJournal([declaration])).toEqual([{ declaration, correction: null, retraction: null, fact: morts(3) }]);
    });

    it('le journal effectif du jour tient compte des contre-déclarations : 3 morts corrigés en 2 comptent pour 2', () => {
      // Given le 5 novembre : trois morts corrigés en deux, et un sac ouvert jamais corrigé
      const deaths = troisMortsDOusmane();
      const bag = Declaration(signe({ id: eventId(2), recordedAt: instant('2026-11-05T18:45:00.000Z') }), sacs(1));
      const otherDay = Declaration(signe({ id: eventId(3), businessDate: jour('2026-11-04') }), morts(7));
      const counter = corrige(morts(2));

      // When
      const november5th = effectiveJournal([deaths, bag, otherDay, counter]).filter(
        (line) => line.declaration.businessDate === '2026-11-05',
      );

      // Then
      expect(november5th).toEqual([
        { declaration: deaths, correction: counter, retraction: null, fact: morts(2) },
        { declaration: bag, correction: null, retraction: null, fact: sacs(1) },
      ]);
    });

    it("l'événement d'origine reste dans le journal, inchangé", () => {
      // Given
      const deaths = troisMortsDOusmane();
      const journal: readonly JournalEvent[] = [deaths, corrige(morts(2))];
      const before = JSON.stringify(journal);

      // When
      const [line] = effectiveJournal(journal);

      // Then
      expect(JSON.stringify(journal)).toBe(before);
      expect(line?.declaration).toBe(deaths);
      expect(line?.declaration).toMatchObject({ type: 'Death', quantity: 3 });
    });

    it("une contre-déclaration ne change ni l'auteur ni la date de saisie de l'événement d'origine", () => {
      // When Awa corrige à 19 h ce qu'Ousmane a écrit à 18 h 30
      const [line] = effectiveJournal([troisMortsDOusmane(), corrige(morts(2))]);

      // Then la ligne garde la signature d'Ousmane, et la correction porte celle d'Awa
      expect(line?.declaration).toMatchObject({ authorId: OUSMANE, recordedAt: '2026-11-05T18:30:00.000Z' });
      expect(line?.correction).toMatchObject({ authorId: AWA, recordedAt: '2026-11-05T19:00:00.000Z' });
    });

    it("retoucher une ligne du journal effectif ne touche pas au journal", () => {
      // Given
      const declaration = troisMortsDOusmane();
      const journal = [declaration, corrige(morts(2))];
      const [line] = effectiveJournal(journal);

      // When un écran maladroit modifie ce qu'il a reçu
      (line?.fact as { quantity: number }).quantity = 99;

      // Then
      expect(declaration).toMatchObject({ quantity: 3 });
      expect(effectiveJournal(journal)[0]?.fact).toEqual(morts(2));
    });

    it("une contre-déclaration peut elle-même être corrigée : la dernière écrite fait foi, quel que soit l'ordre d'arrivée", () => {
      // Given trois morts corrigés en deux à 19 h, puis en quatre à 20 h
      const at19 = corrige(morts(2));
      const at20 = corrige(morts(4), { id: eventId(101), recordedAt: instant('2026-11-05T20:00:00.000Z') });

      // Then
      for (const journal of [
        [troisMortsDOusmane(), at19, at20],
        [at20, at19, troisMortsDOusmane()],
      ]) {
        expect(effectiveJournal(journal)).toEqual([{ declaration: troisMortsDOusmane(), correction: at20, retraction: null, fact: morts(4) }]);
      }
    });

    it("deux corrections écrites au même instant se départagent toujours de la même façon", () => {
      const one = corrige(morts(2), { id: eventId(100) });
      const other = corrige(morts(5), { id: eventId(101) });

      expect(effectiveJournal([troisMortsDOusmane(), one, other])[0]?.correction).toEqual(other);
      expect(effectiveJournal([other, troisMortsDOusmane(), one])[0]?.correction).toEqual(other);
    });

    it("le gardien corrige une ligne écrite par l'admin à sa place : la ligne garde la signature de l'admin, la correction celle du gardien", () => {
      // Given le gérant déclare trois morts pour le site, puis Ousmane corrige en cinq
      const byAdmin = Declaration(signe({ authorId: LE_GERANT }), morts(3));
      const byCaretaker = corrige(morts(5), { authorId: OUSMANE });

      // When
      const [line] = effectiveJournal([byAdmin, byCaretaker]);

      // Then
      expect(juge(byCaretaker, byAdmin, { authorRole: 'collaborator' })).toEqual({ ok: true, value: byCaretaker });
      expect(line?.declaration).toMatchObject({ authorId: LE_GERANT, quantity: 3 });
      expect(line?.correction).toMatchObject({ authorId: OUSMANE, corrects: uuid(1) });
      expect(line?.fact).toEqual(morts(5));
    });

    it("un événement reçu deux fois ne donne qu'une ligne", () => {
      const journal = [troisMortsDOusmane(), corrige(morts(2)), troisMortsDOusmane(), corrige(morts(2))];

      expect(effectiveJournal(journal)).toEqual([{ declaration: troisMortsDOusmane(), correction: corrige(morts(2)), retraction: null, fact: morts(2) }]);
    });

    it("sous un même identifiant, seul le premier événement reçu compte, comme à l'ingestion", () => {
      // Given deux déclarations différentes, puis deux corrections différentes, sous le même identifiant
      const nineDeaths = Declaration(signe(), morts(9));
      const toTwo = corrige(morts(2));
      const toSeven = corrige(morts(7));

      // Then
      expect(effectiveJournal([troisMortsDOusmane(), nineDeaths])).toEqual([
        { declaration: troisMortsDOusmane(), correction: null, retraction: null, fact: morts(3) },
      ]);
      expect(effectiveJournal([troisMortsDOusmane(), toTwo, toSeven])[0]).toMatchObject({ fact: morts(2) });
    });

    it("une contre-déclaration qui porte l'identifiant de sa déclaration ne corrige rien", () => {
      const sameId = corrige(morts(2), { id: eventId(1) });

      expect(effectiveJournal([troisMortsDOusmane(), sameId])).toEqual([
        { declaration: troisMortsDOusmane(), correction: null, retraction: null, fact: morts(3) },
      ]);
    });

    it("une contre-déclaration dont l'origine n'est pas dans le journal ne crée aucune ligne", () => {
      expect(effectiveJournal([corrige(morts(2))])).toEqual([]);
    });

    it("les lignes sortent dans l'ordre où les déclarations ont été écrites, quel que soit l'ordre d'arrivée", () => {
      // Given le sac écrit à 18 h 45 arrive avant les morts écrits à 18 h 30
      const bag = Declaration(signe({ id: eventId(2), recordedAt: instant('2026-11-05T18:45:00.000Z') }), sacs(1));

      expect(effectiveJournal([bag, troisMortsDOusmane()]).map((line) => line.declaration.type)).toEqual(['Death', 'BagOpened']);
    });

    it("pour tout journal, le résultat ne dépend ni de l'ordre d'arrivée ni des doublons (property-based)", () => {
      // Given quatre déclarations et jusqu'à douze corrections, écrites à des minutes quelconques
      const minute = (offset: number): Instant => instant(new Date(Date.UTC(2026, 10, 5, 19, offset)).toISOString());
      const declarations = [1, 2, 3, 4].map((rank) => Declaration(signe({ id: eventId(rank) }), morts(rank)));
      const aCorrection = fc.record({
        target: fc.integer({ min: 1, max: 4 }),
        quantity: fc.integer({ min: 1, max: 50 }),
        at: fc.integer({ min: 0, max: 5 }),
      });
      const aJournal = fc.array(aCorrection, { maxLength: 12 }).map((corrections) => [
        ...declarations,
        ...corrections.map(({ target, quantity, at }, rank) =>
          corrige(morts(quantity), { id: eventId(100 + rank), recordedAt: minute(at) }, eventId(target)),
        ),
      ]);
      // Every event arrives twice, in any order.
      const aJournalAndItsReplay = aJournal.chain((journal) =>
        fc.tuple(fc.constant(journal), fc.shuffledSubarray([...journal, ...journal], { minLength: journal.length * 2 })),
      );

      fc.assert(
        fc.property(aJournalAndItsReplay, ([journal, replayed]) => {
          expect(effectiveJournal(replayed)).toEqual(effectiveJournal(journal));
        }),
      );
    });
  });
});
