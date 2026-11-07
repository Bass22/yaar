import { unwrap } from '@kit';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BusinessDay, TimeZone } from './business-day';
import type { Campaign } from './campaign';
import { effectiveJournal, validateCounterDeclaration } from './counter-declaration';
import { authorizeDeclaration } from './declaration-policy';
import { CampaignId, JournalEventId, SiteId, TenantId, UserId } from './ids';
import { Instant } from './instant';
import { CounterDeclaration, Declaration, Retraction, type EventEnvelope, type Fact, type JournalEvent } from './journal-event';
import { Quantity } from './quantity';
import { validateRetraction } from './retraction';
import type { Role } from './role';

// Spec: Cahier des charges — « Corrections », annulation : une déclaration faite par erreur
// s'annule, reste au journal et ne compte plus ; seul l'admin annule pour le moment ;
// l'annulation est définitive et l'emporte sur toute correction. CLAUDE.md §4 règle 1.

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const eventId = (rank: number): JournalEventId => unwrap(JournalEventId(uuid(rank)));
const jour = (iso: string): BusinessDay => unwrap(BusinessDay(iso));
const instant = (iso: string): Instant => unwrap(Instant(iso));
const morts = (count: number): Fact => ({ type: 'Death', quantity: unwrap(Quantity(count)) });

const OUSMANE = unwrap(UserId(uuid(51)));
const LE_GERANT = unwrap(UserId(uuid(54)));
const DAKAR = unwrap(TimeZone('Africa/Dakar'));

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

// Ousmane declares three deaths on November 5th at 18:30.
const troisMortsDOusmane = (): Declaration => Declaration(signe(), morts(3));

// The manager takes that declaration back at 20:00 the same evening, unless said otherwise.
function annule(overrides: Partial<EventEnvelope> = {}, target = eventId(1)): Retraction {
  return Retraction(
    signe({ id: eventId(200), authorId: LE_GERANT, recordedAt: instant('2026-11-05T20:00:00.000Z'), ...overrides }),
    target,
  );
}

const corrige = (fact: Fact, overrides: Partial<EventEnvelope> = {}): CounterDeclaration =>
  CounterDeclaration(signe({ id: eventId(100), recordedAt: instant('2026-11-05T19:00:00.000Z'), ...overrides }), eventId(1), fact);

type Judgement = { readonly authorRole?: Role; readonly campaign?: Campaign; readonly alreadyRetracted?: boolean };

const juge = (
  retraction: Retraction,
  retracted: JournalEvent,
  { authorRole = 'admin', campaign = uneCampagneEnCours(), alreadyRetracted = false }: Judgement = {},
) => validateRetraction(retraction, { retracted, alreadyRetracted, campaign, timeZone: DAKAR, author: { id: retraction.authorId, role: authorRole } });

const lEquipe = { siteId: unwrap(SiteId(uuid(3))), primaryCaretaker: OUSMANE, substitutes: [], strictMode: false };

describe('Annulation', () => {
  describe('une annulation tracée', () => {
    it("une annulation est un événement signé qui nomme la déclaration qu'elle annule, et ne porte aucun fait", () => {
      // When le gérant annule les trois morts d'Ousmane
      const retraction = annule();

      // Then
      expect(retraction).toEqual({ ...signe(), id: uuid(200), authorId: LE_GERANT, recordedAt: '2026-11-05T20:00:00.000Z', retracts: uuid(1) });
      expect(juge(retraction, troisMortsDOusmane())).toEqual({ ok: true, value: retraction });
    });

    it("une annulation construite ne peut plus être modifiée, et n'emporte aucun champ hors du schéma", () => {
      // Given une enveloppe où s'est glissé un champ de trop
      const smuggled = { ...signe({ id: eventId(200) }), motif: 'erreur de saisie' };

      // When
      const retraction = Retraction(smuggled, eventId(1));

      // Then
      expect(Object.isFrozen(retraction)).toBe(true);
      expect(retraction).not.toHaveProperty('motif');
      expect(() => {
        (retraction as { retracts: JournalEventId }).retracts = eventId(9);
      }).toThrow(TypeError);
    });
  });

  describe('même cahier, même jour, la déclaration elle-même', () => {
    it("une annulation vise une déclaration du même élevage, du même site et de la même campagne", () => {
      const elsewhere: Partial<EventEnvelope>[] = [
        { siteId: unwrap(SiteId(uuid(30))) },
        { campaignId: unwrap(CampaignId(uuid(40))) },
        { tenantId: unwrap(TenantId(uuid(20))) },
      ];

      for (const overrides of elsewhere) {
        expect(juge(annule(overrides), troisMortsDOusmane())).toEqual({ ok: false, error: { kind: 'CorrectsEventElsewhere' } });
      }
    });

    it("une annulation porte le jour de la déclaration qu'elle annule", () => {
      const otherDay = annule({ businessDate: jour('2026-11-04') });

      expect(juge(otherDay, troisMortsDOusmane())).toEqual({ ok: false, error: { kind: 'CorrectionChangesBusinessDate' } });
    });

    it("une annulation vise la déclaration d'origine : ni une correction, ni une autre annulation", () => {
      // Given une correction, puis une annulation déjà écrite
      const counter = corrige(morts(2));
      const first = annule();

      // Then
      expect(juge(annule({ id: eventId(201) }, counter.id), counter)).toEqual({ ok: false, error: { kind: 'CorrectsACounterDeclaration' } });
      expect(juge(annule({ id: eventId(201) }, first.id), first)).toEqual({ ok: false, error: { kind: 'CorrectsACounterDeclaration' } });
    });

    it("une annulation ne porte pas l'identifiant de la déclaration qu'elle annule", () => {
      expect(juge(annule({ id: eventId(1) }), troisMortsDOusmane())).toEqual({ ok: false, error: { kind: 'CorrectsItself' } });
    });

    it("juger une annulation contre un autre événement que celui qu'elle nomme est une panne", () => {
      const another = Declaration(signe({ id: eventId(7) }), morts(3));

      expect(() => juge(annule(), another)).toThrow(TypeError);
    });
  });

  describe("seul l'admin annule", () => {
    it("l'admin annule une déclaration du gardien", () => {
      const retraction = annule();

      expect(authorizeDeclaration(retraction, { author: { id: LE_GERANT, role: 'admin' }, site: lEquipe })).toEqual({ ok: true, value: retraction });
    });

    it("le gardien n'annule pas, même sa propre déclaration, même titulaire du site", () => {
      const byCaretaker = annule({ authorId: OUSMANE });

      expect(authorizeDeclaration(byCaretaker, { author: { id: OUSMANE, role: 'collaborator' }, site: lEquipe })).toEqual({
        ok: false,
        error: { kind: 'RetractionByAdminOnly' },
      });
    });
  });

  describe('jugée comme une déclaration', () => {
    it("l'admin annule une déclaration ancienne : vingt jours après, tant que la campagne est en cours", () => {
      const late = annule({ recordedAt: instant('2026-11-25T09:00:00.000Z') });

      expect(juge(late, troisMortsDOusmane()).ok).toBe(true);
    });

    it('une annulation écrite après la clôture de la campagne est refusée', () => {
      // Given une campagne clôturée le 6 novembre à midi
      const campaign = uneCampagneEnCours({ closedAt: instant('2026-11-06T12:00:00.000Z') });
      const afterClosing = annule({ recordedAt: instant('2026-11-06T13:00:00.000Z') });

      expect(juge(afterClosing, troisMortsDOusmane(), { campaign })).toEqual({ ok: false, error: { kind: 'CampaignClosed' } });
    });
  });

  describe('définitive', () => {
    it('une déclaration déjà annulée ne se ré-annule pas', () => {
      const again = annule({ id: eventId(201) });

      expect(juge(again, troisMortsDOusmane(), { alreadyRetracted: true })).toEqual({ ok: false, error: { kind: 'DeclarationRetracted' } });
    });

    it("une correction ne vise pas une annulation : on ne corrige que la déclaration d'origine", () => {
      const retraction = annule();
      const ofTheRetraction = CounterDeclaration(signe({ id: eventId(100) }), retraction.id, morts(2));
      const context = { corrected: retraction, correctedIsRetracted: false, campaign: uneCampagneEnCours(), timeZone: DAKAR, author: { id: ofTheRetraction.authorId, role: 'admin' } } as const;

      expect(validateCounterDeclaration(ofTheRetraction, context)).toEqual({ ok: false, error: { kind: 'CorrectsACounterDeclaration' } });
    });

    it('une déclaration annulée ne se corrige plus', () => {
      // Given une correction écrite après l'annulation
      const counter = corrige(morts(5), { recordedAt: instant('2026-11-05T21:00:00.000Z') });
      const context = { corrected: troisMortsDOusmane(), campaign: uneCampagneEnCours(), timeZone: DAKAR, author: { id: counter.authorId, role: 'collaborator' } } as const;

      // Then
      expect(validateCounterDeclaration(counter, { ...context, correctedIsRetracted: true })).toEqual({
        ok: false,
        error: { kind: 'DeclarationRetracted' },
      });
      expect(validateCounterDeclaration(counter, { ...context, correctedIsRetracted: false }).ok).toBe(true);
    });
  });

  describe('le journal effectif', () => {
    it('une déclaration annulée reste au journal et ne compte plus', () => {
      // Given
      const declaration = troisMortsDOusmane();
      const retraction = annule();

      // When
      const lines = effectiveJournal([declaration, retraction]);

      // Then la ligne est là, signée d'Ousmane, avec son annulation — et aucun fait qui compte
      expect(lines).toEqual([{ declaration, correction: null, retraction, fact: null }]);
      expect(lines[0]?.declaration).toMatchObject({ authorId: OUSMANE, quantity: 3 });
    });

    it("une correction ne fait pas recompter une déclaration annulée, qu'elle soit écrite avant ou après, reçue avant ou après", () => {
      // Given l'annulation de 20 h, une correction de 19 h et une correction de 21 h
      const retraction = annule();
      const before = corrige(morts(2));
      const after = corrige(morts(5), { id: eventId(101), recordedAt: instant('2026-11-05T21:00:00.000Z') });

      // Then
      for (const journal of [
        [troisMortsDOusmane(), before, retraction, after],
        [after, retraction, before, troisMortsDOusmane()],
      ]) {
        expect(effectiveJournal(journal)).toEqual([{ declaration: troisMortsDOusmane(), correction: after, retraction, fact: null }]);
      }
    });

    it("annulée deux fois, la déclaration garde la première annulation écrite", () => {
      const at20 = annule();
      const at22 = annule({ id: eventId(201), recordedAt: instant('2026-11-05T22:00:00.000Z') });

      expect(effectiveJournal([troisMortsDOusmane(), at22, at20])[0]?.retraction).toEqual(at20);
      expect(effectiveJournal([at20, troisMortsDOusmane(), at22])[0]?.retraction).toEqual(at20);
    });

    it("une annulation n'annule que la déclaration qu'elle nomme", () => {
      const other = Declaration(signe({ id: eventId(2), recordedAt: instant('2026-11-05T18:45:00.000Z') }), morts(4));

      expect(effectiveJournal([troisMortsDOusmane(), other, annule()]).map((line) => line.fact)).toEqual([null, morts(4)]);
    });

    it("une annulation dont la déclaration n'est pas dans le journal, ou qui nomme une correction, ne change rien", () => {
      const counter = corrige(morts(2));
      const ofTheCounter = annule({}, counter.id);

      expect(effectiveJournal([annule()])).toEqual([]);
      expect(effectiveJournal([troisMortsDOusmane(), counter, ofTheCounter])).toEqual([
        { declaration: troisMortsDOusmane(), correction: counter, retraction: null, fact: morts(2) },
      ]);
    });

    it("pour tout journal, ni l'ordre d'arrivée ni les doublons ne changent ce qui est annulé (property-based)", () => {
      // Given quatre déclarations, des corrections et des annulations écrites à des minutes quelconques
      const minute = (offset: number): Instant => instant(new Date(Date.UTC(2026, 10, 5, 19, offset)).toISOString());
      const declarations = [1, 2, 3, 4].map((rank) => Declaration(signe({ id: eventId(rank) }), morts(rank)));
      const anAfterthought = fc.record({
        target: fc.integer({ min: 1, max: 4 }),
        quantity: fc.integer({ min: 1, max: 50 }),
        at: fc.integer({ min: 0, max: 5 }),
        retracts: fc.boolean(),
      });
      const aJournal = fc.array(anAfterthought, { maxLength: 10 }).map((afterthoughts): JournalEvent[] => [
        ...declarations,
        ...afterthoughts.map(({ target, quantity, at, retracts }, rank) =>
          retracts
            ? Retraction(signe({ id: eventId(200 + rank), authorId: LE_GERANT, recordedAt: minute(at) }), eventId(target))
            : CounterDeclaration(signe({ id: eventId(100 + rank), recordedAt: minute(at) }), eventId(target), morts(quantity)),
        ),
      ]);
      const aJournalAndItsReplay = aJournal.chain((journal) =>
        fc.tuple(fc.constant(journal), fc.shuffledSubarray([...journal, ...journal], { minLength: journal.length * 2 })),
      );

      fc.assert(
        fc.property(aJournalAndItsReplay, ([journal, replayed]) => {
          const lines = effectiveJournal(replayed);

          expect(lines).toEqual(effectiveJournal(journal));
          // A retracted line never counts, whatever was written around it.
          for (const line of lines) {
            expect(line.fact === null).toBe(line.retraction !== null);
          }
        }),
      );
    });
  });
});
