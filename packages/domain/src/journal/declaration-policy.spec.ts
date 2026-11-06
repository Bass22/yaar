import { unwrap } from '@kit';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BusinessDay } from './business-day';
import { authorizeDeclaration, type Author, type SiteStaff } from './declaration-policy';
import { CampaignId, JournalEventId, SiteId, TenantId, UserId } from './ids';
import { Instant } from './instant';
import { Declaration } from './journal-event';
import { Quantity } from './quantity';
import type { Role } from './role';

// Spec: Cahier des charges — « Gouvernance des déclarations » : le cahier appartient au site ;
// un titulaire et des remplaçants ; mode strict optionnel, choix de l'admin ; l'admin peut
// toujours suppléer.

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;

const THE_SITE = unwrap(SiteId(uuid(3)));
const ANOTHER_SITE = unwrap(SiteId(uuid(30)));

const OUSMANE = unwrap(UserId(uuid(51))); // titulaire du site
const AWA = unwrap(UserId(uuid(52))); // remplaçante
const MODOU = unwrap(UserId(uuid(53))); // gardien d'un autre site
const LE_GERANT = unwrap(UserId(uuid(54)));

const gardien = (id: UserId): Author => ({ id, role: 'collaborator' });
const admin = (id: UserId = LE_GERANT): Author => ({ id, role: 'admin' });

// The henhouse of Ousmane, with Awa as substitute; strict mode is off unless the admin sets it.
function lEquipeDuSite(overrides: Partial<SiteStaff> = {}): SiteStaff {
  return { siteId: THE_SITE, primaryCaretaker: OUSMANE, substitutes: [AWA], strictMode: false, ...overrides };
}

const enModeStrict = (overrides: Partial<SiteStaff> = {}): SiteStaff => lEquipeDuSite({ strictMode: true, ...overrides });

function troisMortsDeclaresPar(authorId: UserId): Declaration {
  return Declaration(
    {
      id: unwrap(JournalEventId(uuid(1))),
      tenantId: unwrap(TenantId(uuid(2))),
      siteId: THE_SITE,
      campaignId: unwrap(CampaignId(uuid(4))),
      authorId,
      businessDate: unwrap(BusinessDay('2026-11-05')),
      recordedAt: unwrap(Instant('2026-11-05T18:30:00.000Z')),
    },
    { type: 'Death', quantity: unwrap(Quantity(3)) },
  );
}

const declare = (author: Author, site: SiteStaff) =>
  authorizeDeclaration(troisMortsDeclaresPar(author.id), { author, site });

describe('Qui a le droit de déclarer', () => {
  describe('le cahier appartient au site', () => {
    it('le titulaire du site peut déclarer', () => {
      // Given
      const event = troisMortsDeclaresPar(OUSMANE);

      // When
      const result = authorizeDeclaration(event, { author: gardien(OUSMANE), site: lEquipeDuSite() });

      // Then
      expect(result).toEqual({ ok: true, value: event });
    });

    it('sans mode strict, un remplaçant déclare comme le titulaire', () => {
      expect(declare(gardien(AWA), lEquipeDuSite()).ok).toBe(true);
    });

    it("un collaborateur d'un autre site ne peut pas déclarer", () => {
      expect(declare(gardien(MODOU), lEquipeDuSite())).toEqual({ ok: false, error: { kind: 'NotAssignedToSite' } });
    });

    it("un site sans titulaire garde ses remplaçants", () => {
      expect(declare(gardien(AWA), lEquipeDuSite({ primaryCaretaker: null })).ok).toBe(true);
    });
  });

  describe('mode strict', () => {
    it('en mode strict, seul le titulaire du site déclare', () => {
      expect(declare(gardien(OUSMANE), enModeStrict()).ok).toBe(true);
      expect(declare(gardien(AWA), enModeStrict())).toEqual({ ok: false, error: { kind: 'StrictModePrimaryOnly' } });
    });

    it("en mode strict, un collaborateur d'un autre site reste refusé pour la même raison qu'ailleurs", () => {
      expect(declare(gardien(MODOU), enModeStrict())).toEqual({ ok: false, error: { kind: 'NotAssignedToSite' } });
    });

    it('en mode strict sans titulaire, aucun collaborateur ne déclare', () => {
      expect(declare(gardien(AWA), enModeStrict({ primaryCaretaker: null }))).toEqual({
        ok: false,
        error: { kind: 'StrictModePrimaryOnly' },
      });
    });
  });

  describe("l'admin supplée", () => {
    it("l'admin peut toujours déclarer à la place du gardien, sans être affecté au site", () => {
      expect(declare(admin(), lEquipeDuSite()).ok).toBe(true);
    });

    it("le mode strict n'arrête pas l'admin", () => {
      expect(declare(admin(), enModeStrict()).ok).toBe(true);
      expect(declare(admin(), enModeStrict({ primaryCaretaker: null, substitutes: [] })).ok).toBe(true);
    });

    it("l'admin signe de son propre nom : un événement au nom du gardien qu'il supplée n'est pas le sien", () => {
      // Given un événement signé Ousmane, présenté par l'admin
      const signedByOusmane = troisMortsDeclaresPar(OUSMANE);

      // Then il n'est pas jugé comme une déclaration de l'admin
      expect(() => authorizeDeclaration(signedByOusmane, { author: admin(), site: lEquipeDuSite() })).toThrow(TypeError);
      // And celui que l'admin signe lui-même passe, avec son nom
      expect(declare(admin(), lEquipeDuSite())).toMatchObject({ ok: true, value: { authorId: LE_GERANT } });
    });
  });

  describe('dans le doute', () => {
    it("un rôle qui n'est ni admin ni collaborateur ne déclare jamais, même inscrit dans l'équipe du site", () => {
      // Given un investisseur (lecture seule) inscrit par erreur comme remplaçant, puis comme titulaire
      const investor: Author = { id: MODOU, role: 'investor' as Role };
      const asSubstitute = lEquipeDuSite({ substitutes: [AWA, MODOU] });
      const asPrimary = lEquipeDuSite({ primaryCaretaker: MODOU });

      // Then
      for (const site of [asSubstitute, asPrimary, lEquipeDuSite()]) {
        expect(declare(investor, site)).toEqual({ ok: false, error: { kind: 'RoleCannotDeclare' } });
      }
    });

    it("juger un événement avec un autre auteur que le sien est une panne, pas un refus métier", () => {
      const event = troisMortsDeclaresPar(MODOU);

      expect(() => authorizeDeclaration(event, { author: gardien(OUSMANE), site: lEquipeDuSite() })).toThrow(TypeError);
    });

    it("juger un événement avec l'équipe d'un autre site est une panne, pas un refus métier", () => {
      const site = lEquipeDuSite({ siteId: ANOTHER_SITE });

      expect(() => declare(gardien(OUSMANE), site)).toThrow(TypeError);
    });
  });

  it("pour toute équipe, l'admin déclare toujours ; un collaborateur déclare s'il est titulaire, ou remplaçant hors mode strict (property-based)", () => {
    const aPlace = fc.constantFrom('primary', 'substitute', 'elsewhere');

    fc.assert(
      fc.property(aPlace, fc.boolean(), fc.boolean(), (place, strictMode, hasPrimary) => {
        const site = lEquipeDuSite({
          strictMode,
          primaryCaretaker: place === 'primary' ? AWA : hasPrimary ? OUSMANE : null,
          substitutes: place === 'substitute' ? [AWA] : [],
        });
        const expected = place === 'primary' || (place === 'substitute' && !strictMode);

        return declare(gardien(AWA), site).ok === expected && declare(admin(), site).ok;
      }),
    );
  });
});
