import { unwrap } from '@kit';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addDays, BusinessDay, TimeZone } from './business-day';
import type { Campaign } from './campaign';
import { CampaignId, JournalEventId, SiteId, TenantId, UserId } from './ids';
import { Instant } from './instant';
import { JournalEvent } from './journal-event';
import { Quantity } from './quantity';
import type { Role } from './role';
import { validateDeclaration, type DeclarationContext } from './validate-declaration';

// Spec: Cahier des charges — « Rattrapage » (trois jours pour le gardien, comptés depuis la
// saisie ; l'admin supplée pour tout jour depuis la mise en place), « Clôture de campagne ».

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const jour = (iso: string): BusinessDay => unwrap(BusinessDay(iso));
const instant = (iso: string): Instant => unwrap(Instant(iso));

const DAKAR = unwrap(TimeZone('Africa/Dakar')); // UTC+0
const DOUALA = unwrap(TimeZone('Africa/Douala')); // UTC+1

const THE_SITE = unwrap(SiteId(uuid(3)));
const ANOTHER_SITE = unwrap(SiteId(uuid(30)));
const THE_CAMPAIGN = unwrap(CampaignId(uuid(4)));

// Chicks placed on October 15th, on the site of the caretaker; the campaign is still running.
function uneCampagneEnCours(overrides: Partial<Campaign> = {}): Campaign {
  return { id: THE_CAMPAIGN, siteId: THE_SITE, placementDay: jour('2026-10-15'), closedAt: null, ...overrides };
}

// Three deaths written down on November 5th at 18:30 in Dakar, for the day given.
function troisMortsPourLe(businessDate: string, recordedAt = '2026-11-05T18:30:00.000Z'): JournalEvent {
  return JournalEvent(
    {
      id: unwrap(JournalEventId(uuid(1))),
      tenantId: unwrap(TenantId(uuid(2))),
      siteId: THE_SITE,
      campaignId: THE_CAMPAIGN,
      authorId: unwrap(UserId(uuid(5))),
      businessDate: jour(businessDate),
      recordedAt: instant(recordedAt),
    },
    { type: 'Death', quantity: unwrap(Quantity(3)) },
  );
}

function declarePar(authorRole: Role, overrides: Partial<DeclarationContext> = {}): DeclarationContext {
  return { campaign: uneCampagneEnCours(), timeZone: DAKAR, authorRole, ...overrides };
}

const parLeGardien = (overrides: Partial<DeclarationContext> = {}): DeclarationContext =>
  declarePar('collaborator', overrides);
const parLAdmin = (overrides: Partial<DeclarationContext> = {}): DeclarationContext => declarePar('admin', overrides);

describe("Validation d'une déclaration", () => {
  it("une déclaration du jour, sur le site de la campagne en cours, est acceptée telle quelle", () => {
    // Given
    const event = troisMortsPourLe('2026-11-05');

    // When
    const result = validateDeclaration(event, parLeGardien());

    // Then
    expect(result).toEqual({ ok: true, value: event });
  });

  describe('jour futur', () => {
    it('une déclaration pour une date métier future est refusée', () => {
      for (const context of [parLeGardien(), parLAdmin()]) {
        expect(validateDeclaration(troisMortsPourLe('2026-11-06'), context)).toEqual({
          ok: false,
          error: { kind: 'FutureBusinessDate' },
        });
      }
    });

    it('le futur se juge dans le fuseau du site, au moment de la saisie', () => {
      // Given une saisie à 23 h 30 à Dakar, soit déjà 0 h 30 le 6 à Douala
      const event = troisMortsPourLe('2026-11-06', '2026-11-05T23:30:00.000Z');

      // Then le 6 est encore demain à Dakar, et déjà aujourd'hui à Douala
      expect(validateDeclaration(event, parLeGardien({ timeZone: DAKAR })).ok).toBe(false);
      expect(validateDeclaration(event, parLeGardien({ timeZone: DOUALA })).ok).toBe(true);
    });
  });

  describe('mise en place', () => {
    it('une déclaration antérieure à la mise en place de la campagne est refusée', () => {
      // Given des poussins mis en place le 4 novembre
      const campaign = uneCampagneEnCours({ placementDay: jour('2026-11-04') });

      for (const authorRole of ['collaborator', 'admin'] as const) {
        // Then la veille de la mise en place est refusée, le jour même est accepté
        expect(validateDeclaration(troisMortsPourLe('2026-11-03'), declarePar(authorRole, { campaign }))).toEqual({
          ok: false,
          error: { kind: 'BusinessDateBeforePlacement' },
        });
        expect(validateDeclaration(troisMortsPourLe('2026-11-04'), declarePar(authorRole, { campaign })).ok).toBe(true);
      }
    });
  });

  describe('rattrapage', () => {
    it("le gardien déclare pour aujourd'hui, hier ou avant-hier", () => {
      for (const businessDate of ['2026-11-05', '2026-11-04', '2026-11-03']) {
        expect(validateDeclaration(troisMortsPourLe(businessDate), parLeGardien()).ok).toBe(true);
      }
    });

    it('le gardien ne déclare pas au-delà de trois jours', () => {
      expect(validateDeclaration(troisMortsPourLe('2026-11-02'), parLeGardien())).toEqual({
        ok: false,
        error: { kind: 'CatchUpWindowPassed' },
      });
    });

    it("l'admin supplée pour n'importe quel jour depuis la mise en place", () => {
      for (const businessDate of ['2026-11-02', '2026-10-20', '2026-10-15']) {
        expect(validateDeclaration(troisMortsPourLe(businessDate), parLAdmin()).ok).toBe(true);
      }
    });

    it("un rôle que la règle ne connaît pas est traité comme le gardien, jamais comme l'admin", () => {
      const context = declarePar('investor' as Role);

      expect(validateDeclaration(troisMortsPourLe('2026-11-02'), context)).toEqual({
        ok: false,
        error: { kind: 'CatchUpWindowPassed' },
      });
    });

    it("les trois jours se comptent depuis la saisie : une déclaration restée hors-ligne n'attend aucune horloge", () => {
      // The rule takes no clock: whenever the server replays it, the answer is the same.
      expect(validateDeclaration).toHaveLength(2);
    });

    it("pour tout écart entre le jour déclaré et le jour de saisie, le gardien est accepté de 0 à 2 jours, l'admin dès 0 (property-based)", () => {
      // Given une campagne assez ancienne pour que la mise en place ne joue pas
      const campaign = uneCampagneEnCours({ placementDay: jour('2026-01-01') });

      fc.assert(
        fc.property(fc.integer({ min: -30, max: 30 }), (daysAgo) => {
          const event = troisMortsPourLe(addDays(jour('2026-11-05'), -daysAgo));

          return (
            validateDeclaration(event, parLeGardien({ campaign })).ok === (daysAgo >= 0 && daysAgo <= 2) &&
            validateDeclaration(event, parLAdmin({ campaign })).ok === daysAgo >= 0
          );
        }),
      );
    });
  });

  describe('campagne clôturée', () => {
    it('une déclaration faite après la clôture de la campagne est refusée', () => {
      // Given une campagne clôturée le 5 novembre à midi
      const campaign = uneCampagneEnCours({ closedAt: instant('2026-11-05T12:00:00.000Z') });

      for (const authorRole of ['collaborator', 'admin'] as const) {
        // When la déclaration est écrite à 18 h 30
        const result = validateDeclaration(troisMortsPourLe('2026-11-05'), declarePar(authorRole, { campaign }));

        // Then
        expect(result).toEqual({ ok: false, error: { kind: 'CampaignClosed' } });
      }
    });

    it("à l'instant même de la clôture, la campagne est déjà clôturée", () => {
      const campaign = uneCampagneEnCours({ closedAt: instant('2026-11-05T18:30:00.000Z') });

      expect(validateDeclaration(troisMortsPourLe('2026-11-05'), parLeGardien({ campaign })).ok).toBe(false);
    });

    it("une déclaration écrite avant la clôture n'est pas refusée par cette règle, même relue après", () => {
      // Given une campagne clôturée le 5 à 20 h, après la saisie de 18 h 30
      const campaign = uneCampagneEnCours({ closedAt: instant('2026-11-05T20:00:00.000Z') });

      // Then son sort à la synchronisation est la décision ouverte de X.3
      expect(validateDeclaration(troisMortsPourLe('2026-11-05'), parLeGardien({ campaign })).ok).toBe(true);
    });
  });

  describe('site de la campagne', () => {
    it("une déclaration sur un site qui n'est pas celui de la campagne est refusée", () => {
      // Given une campagne ouverte sur un autre poulailler
      const campaign = uneCampagneEnCours({ siteId: ANOTHER_SITE });

      for (const authorRole of ['collaborator', 'admin'] as const) {
        expect(validateDeclaration(troisMortsPourLe('2026-11-05'), declarePar(authorRole, { campaign }))).toEqual({
          ok: false,
          error: { kind: 'SiteNotOfCampaign' },
        });
      }
    });

    it("valider une déclaration contre une autre campagne que la sienne est une panne, pas un refus métier", () => {
      const campaign = uneCampagneEnCours({ id: unwrap(CampaignId(uuid(40))) });

      expect(() => validateDeclaration(troisMortsPourLe('2026-11-05'), parLeGardien({ campaign }))).toThrow(TypeError);
    });
  });
});
