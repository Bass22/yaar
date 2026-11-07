import { unwrap } from '@kit';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BusinessDay } from './business-day';
import { declaredBefore, summarizeDay, validateAgainstDay } from './day-summary';
import { CampaignId, JournalEventId, SiteId, TenantId, UserId } from './ids';
import { Instant } from './instant';
import { CounterDeclaration, Declaration, Retraction, type EventEnvelope, type Fact, type JournalEvent } from './journal-event';
import { Quantity } from './quantity';

// Spec: Cahier des charges — « Le zéro est une déclaration » (zéro mort ≠ pas de déclaration ;
// les morts d'un jour s'ajoutent ; « rien perdu » refusé après des morts), « Garde-fous
// anti-doublon » (un autre, ou soi-même, a déjà déclaré). CLAUDE.md §4 règle 10.

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const quantite = (count: number): Quantity => unwrap(Quantity(count));
const jour = (iso: string): BusinessDay => unwrap(BusinessDay(iso));

const LA_BANDE = unwrap(CampaignId(uuid(4)));
const LE_5_NOVEMBRE = jour('2026-11-05');
const OUSMANE = unwrap(UserId(uuid(51)));
const AWA = unwrap(UserId(uuid(52)));
const LE_GERANT = unwrap(UserId(uuid(54)));

const morts = (count: number): Fact => ({ type: 'Death', quantity: quantite(count) });
const sacs = (count: number): Fact => ({ type: 'BagOpened', quantity: quantite(count) });
const RIEN_PERDU: Fact = { type: 'NoLoss' };
const manquants = (count: number): Fact => ({ type: 'Loss', lossType: 'Missing', quantity: quantite(count) });
const donnes = (count: number): Fact => ({ type: 'Loss', lossType: 'Donation', quantity: quantite(count) });

// The n-th event of the notebook, written by Ousmane for November 5th at the given hour.
function signe(rank: number, hour: number, overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    id: unwrap(JournalEventId(uuid(rank))),
    tenantId: unwrap(TenantId(uuid(2))),
    siteId: unwrap(SiteId(uuid(3))),
    campaignId: LA_BANDE,
    authorId: OUSMANE,
    businessDate: LE_5_NOVEMBRE,
    recordedAt: unwrap(Instant(new Date(Date.UTC(2026, 10, 5, hour, rank)).toISOString())),
    ...overrides,
  };
}

const LE_MATIN = 7;
const A_MIDI = 13;
const LE_SOIR = 19;

const declare = (rank: number, hour: number, fact: Fact, overrides: Partial<EventEnvelope> = {}): Declaration =>
  Declaration(signe(rank, hour, overrides), fact);

const resume = (journal: readonly JournalEvent[]) => summarizeDay(journal, { campaignId: LA_BANDE, businessDate: LE_5_NOVEMBRE });

describe("Résumé d'un jour", () => {
  describe('trois états, jamais confondus', () => {
    it('un jour sans aucune déclaration est « non déclaré »', () => {
      expect(resume([])).toEqual({ mortality: { kind: 'NotDeclared' }, deaths: [], bagsOpened: [] });
    });

    it('un jour avec « rien perdu » est « zéro déclaré », distinct de « non déclaré », et ne porte aucun zéro', () => {
      // When
      const summary = resume([declare(1, LE_SOIR, RIEN_PERDU)]);

      // Then
      expect(summary.mortality).toEqual({ kind: 'NoLossDeclared' });
      expect(summary.mortality).not.toEqual(resume([]).mortality);
      expect(JSON.stringify(summary)).not.toContain('0');
    });

    it('un jour avec des morts donne leur total', () => {
      expect(resume([declare(1, LE_SOIR, morts(3))]).mortality).toEqual({ kind: 'DeathsDeclared', deaths: 3 });
    });

    it("un jour qui n'a que des sacs ouverts reste « non déclaré » pour les pertes", () => {
      expect(resume([declare(1, LE_SOIR, sacs(2))]).mortality).toEqual({ kind: 'NotDeclared' });
    });
  });

  describe("les morts d'un même jour s'ajoutent", () => {
    it('le gardien déclare le matin, à midi et le soir : les trois déclarations comptent', () => {
      // Given 3 morts le matin, 2 à midi, 1 le soir
      const journal = [declare(1, LE_MATIN, morts(3)), declare(2, A_MIDI, morts(2)), declare(3, LE_SOIR, morts(1))];

      // Then 3 + 2 + 1 = 6
      expect(resume(journal).mortality).toEqual({ kind: 'DeathsDeclared', deaths: 6 });
    });

    it('le total est celui du journal effectif : 3 morts corrigés en 2, plus 4, font 6', () => {
      // Given
      const morning = declare(1, LE_MATIN, morts(3));
      const correction = CounterDeclaration(signe(10, A_MIDI), morning.id, morts(2));

      // Then 2 + 4 = 6
      expect(resume([morning, correction, declare(2, LE_SOIR, morts(4))]).mortality).toEqual({ kind: 'DeathsDeclared', deaths: 6 });
    });

    it('des morts écrits après un « rien perdu » l’emportent', () => {
      const journal = [declare(1, LE_MATIN, RIEN_PERDU), declare(2, LE_SOIR, morts(2))];

      expect(resume(journal).mortality).toEqual({ kind: 'DeathsDeclared', deaths: 2 });
    });

    it("seuls le jour et la campagne demandés comptent", () => {
      const journal = [
        declare(1, LE_SOIR, morts(3)),
        declare(2, LE_SOIR, morts(7), { businessDate: jour('2026-11-04') }),
        declare(3, LE_SOIR, morts(9), { campaignId: unwrap(CampaignId(uuid(40))) }),
      ];

      expect(resume(journal).mortality).toEqual({ kind: 'DeathsDeclared', deaths: 3 });
    });
  });

  describe('une déclaration annulée ne compte plus', () => {
    const annule = (rank: number, declaration: Declaration): Retraction =>
      Retraction(signe(rank, LE_SOIR, { authorId: LE_GERANT }), declaration.id);

    it("une double saisie se rattrape : deux fois 1 mort, l'admin annule la seconde, il reste 1 mort", () => {
      const twice = declare(2, LE_MATIN, morts(1));
      const journal = [declare(1, LE_MATIN, morts(1)), twice, annule(3, twice)];

      expect(resume(journal)).toMatchObject({
        mortality: { kind: 'DeathsDeclared', deaths: 1 },
        deaths: [{ authorId: OUSMANE, quantity: 1 }],
      });
    });

    it('si tous les morts du jour sont annulés, le jour redevient « non déclaré » — pas « zéro déclaré »', () => {
      const deaths = declare(1, LE_MATIN, morts(3));

      expect(resume([deaths, annule(2, deaths)])).toEqual({ mortality: { kind: 'NotDeclared' }, deaths: [], bagsOpened: [] });
    });

    it('« rien perdu » annulé ne dit plus rien du jour', () => {
      const noLoss = declare(1, LE_MATIN, RIEN_PERDU);

      expect(resume([noLoss, annule(2, noLoss)]).mortality).toEqual({ kind: 'NotDeclared' });
    });

    it("des morts annulés n'empêchent plus « rien perdu »", () => {
      // Given 3 morts écrits le matin pour le mauvais jour, annulés ; puis « rien perdu » le soir
      const deaths = declare(1, LE_MATIN, morts(3));
      const noLoss = declare(3, LE_SOIR + 1, RIEN_PERDU);

      expect(validateAgainstDay(noLoss, [deaths, annule(2, deaths)])).toEqual({ ok: true, value: noLoss });
    });

    it("une annulation écrite après « rien perdu » ne le rend pas valable après coup : il se juge au journal tel qu'il était quand il a été écrit, quel que soit l'ordre d'arrivée", () => {
      // Given 3 morts le matin, « rien perdu » à midi, et les morts annulés le soir seulement
      const deaths = declare(1, LE_MATIN, morts(3));
      const noLoss = declare(2, A_MIDI, RIEN_PERDU);
      const lateRetraction = annule(3, deaths);

      // Then à midi les morts tenaient : refusé, que l'annulation soit déjà reçue ou pas
      expect(validateAgainstDay(noLoss, [deaths])).toEqual({ ok: false, error: { kind: 'NoLossAfterDeaths' } });
      expect(validateAgainstDay(noLoss, [deaths, lateRetraction])).toEqual({ ok: false, error: { kind: 'NoLossAfterDeaths' } });
    });
  });

  describe('le gardien ne voit que les morts', () => {
    it("des manquants ou des dons déclarés par l'admin n'entrent pas dans le résumé", () => {
      // Given 3 morts, puis 4 manquants et 6 dons écrits par le gérant
      const journal = [
        declare(1, LE_MATIN, morts(3)),
        declare(2, A_MIDI, manquants(4), { authorId: LE_GERANT }),
        declare(3, A_MIDI, donnes(6), { authorId: LE_GERANT }),
      ];

      // Then
      expect(resume(journal)).toEqual({
        mortality: { kind: 'DeathsDeclared', deaths: 3 },
        deaths: [{ authorId: OUSMANE, quantity: 3 }],
        bagsOpened: [],
      });
    });

    it("un jour qui n'a que des manquants reste « non déclaré » pour le gardien", () => {
      expect(resume([declare(1, A_MIDI, manquants(4), { authorId: LE_GERANT })]).mortality).toEqual({ kind: 'NotDeclared' });
    });
  });

  describe('qui a déjà déclaré, et combien', () => {
    it("le résumé donne, par auteur, ce qui est déjà écrit pour le jour : morts et sacs ouverts", () => {
      // Given Ousmane : 3 morts le matin, 2 le soir, 1 sac ; Awa : 1 mort à midi
      const journal = [
        declare(1, LE_MATIN, morts(3)),
        declare(2, A_MIDI, morts(1), { authorId: AWA }),
        declare(3, LE_SOIR, morts(2)),
        declare(4, LE_SOIR, sacs(1)),
      ];

      // Then Ousmane 3 + 2 = 5 ; Awa 1
      expect(resume(journal)).toMatchObject({
        deaths: [
          { authorId: OUSMANE, quantity: 5 },
          { authorId: AWA, quantity: 1 },
        ],
        bagsOpened: [{ authorId: OUSMANE, quantity: 1 }],
      });
    });

    it("un autre a déjà déclaré le même type ce jour-là : le résumé dit qui et combien", () => {
      // Given Ousmane a écrit 3 morts ; Awa s'apprête à en écrire 2
      const summary = resume([declare(1, LE_MATIN, morts(3))]);

      // Then « Ousmane a déjà écrit 3 morts. Tes 2 morts, c'est EN PLUS ? »
      expect(declaredBefore(summary, 'Death', AWA)).toEqual({ byAuthor: null, byOthers: [{ authorId: OUSMANE, quantity: 3 }] });
    });

    it("le gardien a déjà déclaré lui-même : le résumé dit combien, pour qu'il n'écrive pas le total à la place du supplément", () => {
      // Given Ousmane a écrit 3 morts le matin ; le soir il en compte 5 en tout
      const summary = resume([declare(1, LE_MATIN, morts(3))]);

      // Then « Tu as déjà écrit 3 morts aujourd'hui. »
      expect(declaredBefore(summary, 'Death', OUSMANE)).toEqual({ byAuthor: 3, byOthers: [] });
    });

    it("sans déclaration préalable du même type, rien n'est signalé : ni soi, ni un autre, ni un zéro", () => {
      // Given des morts déjà écrits, mais aucun sac ouvert
      const summary = resume([declare(1, LE_MATIN, morts(3))]);

      expect(declaredBefore(summary, 'BagOpened', OUSMANE)).toEqual({ byAuthor: null, byOthers: [] });
    });

    it("une déclaration corrigée par un autre reste celle de son auteur, avec la quantité corrigée", () => {
      // Given les 3 morts d'Ousmane, corrigés en 2 par Awa
      const deaths = declare(1, LE_MATIN, morts(3));
      const byAwa = CounterDeclaration(signe(10, A_MIDI, { authorId: AWA }), deaths.id, morts(2));

      expect(resume([deaths, byAwa]).deaths).toEqual([{ authorId: OUSMANE, quantity: 2 }]);
    });
  });

  describe('« rien perdu » un jour qui a déjà des morts', () => {
    it('« rien perdu » écrit après des morts du même jour est refusé', () => {
      // Given 3 morts écrits le matin, puis « rien perdu » le soir
      const deaths = declare(1, LE_MATIN, morts(3));
      const noLoss = declare(2, LE_SOIR, RIEN_PERDU, { authorId: AWA });

      expect(validateAgainstDay(noLoss, [deaths])).toEqual({ ok: false, error: { kind: 'NoLossAfterDeaths' } });
    });

    it("« rien perdu » écrit le matin reste valable quand des morts sont écrits le soir, même s'il arrive après eux", () => {
      // Given Awa, hors-ligne, a écrit « rien perdu » le matin ; les morts du soir sont arrivés avant
      const noLoss = declare(2, LE_MATIN, RIEN_PERDU, { authorId: AWA });
      const deaths = declare(1, LE_SOIR, morts(3));

      expect(validateAgainstDay(noLoss, [deaths])).toEqual({ ok: true, value: noLoss });
    });

    it("des morts d'un autre jour ou d'une autre campagne n'empêchent pas « rien perdu »", () => {
      const noLoss = declare(3, LE_SOIR, RIEN_PERDU);
      const elsewhere = [
        declare(1, LE_MATIN, morts(3), { businessDate: jour('2026-11-04') }),
        declare(2, LE_MATIN, morts(3), { campaignId: unwrap(CampaignId(uuid(40))) }),
      ];

      expect(validateAgainstDay(noLoss, elsewhere).ok).toBe(true);
    });

    it("des sacs ouverts ou des manquants déclarés par l'admin n'empêchent pas « rien perdu »", () => {
      const noLoss = declare(3, LE_SOIR, RIEN_PERDU);
      const journal = [declare(1, LE_MATIN, sacs(2)), declare(2, LE_MATIN, manquants(4), { authorId: LE_GERANT })];

      expect(validateAgainstDay(noLoss, journal).ok).toBe(true);
    });

    it("des morts s'écrivent toujours, même après un « rien perdu » ou d'autres morts", () => {
      const later = declare(3, LE_SOIR, morts(2));
      const journal = [declare(1, LE_MATIN, RIEN_PERDU), declare(2, A_MIDI, morts(1))];

      expect(validateAgainstDay(later, journal)).toEqual({ ok: true, value: later });
    });

    it("« rien perdu » rejoué n'est pas refusé à cause de lui-même, ni d'un autre « rien perdu »", () => {
      const noLoss = declare(1, LE_SOIR, RIEN_PERDU);
      const earlier = declare(2, LE_MATIN, RIEN_PERDU, { authorId: AWA });

      expect(validateAgainstDay(noLoss, [earlier, noLoss]).ok).toBe(true);
    });
  });

  it("pour tout journal, ni l'ordre d'arrivée ni les doublons ne changent le résumé (property-based)", () => {
    // Given jusqu'à dix déclarations de deux auteurs, à des heures quelconques
    const aFact = fc.oneof(
      fc.integer({ min: 1, max: 30 }).map(morts),
      fc.integer({ min: 1, max: 5 }).map(sacs),
      fc.constant(RIEN_PERDU),
      fc.integer({ min: 1, max: 9 }).map(manquants),
    );
    const aJournal = fc
      .array(fc.tuple(aFact, fc.integer({ min: 5, max: 21 }), fc.boolean()), { maxLength: 10 })
      .map((entries) => entries.map(([fact, hour, byAwa], index) => declare(index + 1, hour, fact, byAwa ? { authorId: AWA } : {})));
    const aJournalAndItsReplay = aJournal.chain((journal) =>
      fc.tuple(fc.constant(journal), fc.shuffledSubarray([...journal, ...journal], { minLength: journal.length * 2 })),
    );

    fc.assert(
      fc.property(aJournalAndItsReplay, ([journal, replayed]) => {
        expect(resume(replayed)).toEqual(resume(journal));
      }),
    );
  });

  it("pour tout journal, le total des morts du jour est la somme de ce que chaque auteur a écrit (property-based)", () => {
    const aJournal = fc
      .array(fc.tuple(fc.integer({ min: 1, max: 30 }), fc.integer({ min: 5, max: 21 }), fc.boolean()), { minLength: 1, maxLength: 10 })
      .map((entries) => entries.map(([count, hour, byAwa], index) => declare(index + 1, hour, morts(count), byAwa ? { authorId: AWA } : {})));

    fc.assert(
      fc.property(aJournal, (journal) => {
        const summary = resume(journal);
        const written = journal.reduce((total, declaration) => total + (declaration.type === 'Death' ? declaration.quantity : 0), 0);

        expect(summary.mortality).toEqual({ kind: 'DeathsDeclared', deaths: written });
        expect(summary.deaths.reduce((total, entry) => total + entry.quantity, 0)).toBe(written);
      }),
    );
  });
});
