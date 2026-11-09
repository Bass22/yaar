import { unwrap } from '@kit';
import { describe, expect, it } from 'vitest';
import { BusinessDay } from './business-day';
import { DEFAULT_PLANNED_DURATION, MAX_CAMPAIGN_DAYS, validateCampaignOpening, type CampaignOpeningRequest } from './campaign';
import { STRAINS } from './strain';

// Spec: backlog O.2 — ouvrir une campagne ; cahier des charges « Ouvrir une bande » (décisions du
// 2026-11-09 : durée prévue 45 jours par défaut, 60 au plus ; jamais de mise en place future ;
// pas plus de 60 jours dans le passé) ; « Référentiels » (la campagne référence sa souche).

const AUJOURDHUI = unwrap(BusinessDay('2026-11-09'));
const uneOuverture = (fields: Partial<CampaignOpeningRequest> = {}): CampaignOpeningRequest => ({
  strain: 'Cobb500',
  plannedHeadcount: 1000,
  placementDay: '2026-11-09',
  plannedDuration: 45,
  ...fields,
});
const ouvre = (fields: Partial<CampaignOpeningRequest> = {}) => validateCampaignOpening(uneOuverture(fields), AUJOURDHUI);

describe('Ouvrir une bande', () => {
  it('une bande Cobb 500 de 1 000 poussins mis en place aujourd’hui, pour 45 jours, s’ouvre ; elle porte sa souche et sa courbe', () => {
    const opening = unwrap(ouvre());

    expect(opening).toEqual({ strain: STRAINS[0], plannedHeadcount: 1000, placementDay: '2026-11-09', plannedDuration: 45 });
    expect(opening.strain.targets[21]?.weight).toBe(843);
  });

  it('la durée prévue vaut 45 jours par défaut et 60 au plus', () => {
    expect([DEFAULT_PLANNED_DURATION, MAX_CAMPAIGN_DAYS]).toEqual([45, 60]);
  });

  it('une souche inconnue est refusée', () => {
    expect(ouvre({ strain: 'Ross308' })).toEqual({ ok: false, error: { kind: 'UnknownStrain' } });
  });

  it('un effectif nul, négatif ou fractionnaire est refusé : il faut au moins un poussin', () => {
    expect([ouvre({ plannedHeadcount: 0 }), ouvre({ plannedHeadcount: -5 }), ouvre({ plannedHeadcount: 2.5 })]).toEqual([
      { ok: false, error: { kind: 'InvalidQuantity', value: 0 } },
      { ok: false, error: { kind: 'InvalidQuantity', value: -5 } },
      { ok: false, error: { kind: 'InvalidQuantity', value: 2.5 } },
    ]);
  });

  it('une date qui n’en est pas une est refusée', () => {
    expect(ouvre({ placementDay: '2026-02-30' })).toEqual({ ok: false, error: { kind: 'InvalidBusinessDay' } });
  });

  it('la mise en place n’est jamais dans le futur : demain est refusé, aujourd’hui accepté', () => {
    expect(ouvre({ placementDay: '2026-11-10' })).toEqual({ ok: false, error: { kind: 'PlacementInFuture' } });
    expect(ouvre({ placementDay: '2026-11-09' }).ok).toBe(true);
  });

  it('une bande déjà en cours se reprend jusqu’à 60 jours en arrière ; au-delà, elle serait finie : refusée', () => {
    expect(ouvre({ placementDay: '2026-09-10' }).ok).toBe(true); // J60
    expect(ouvre({ placementDay: '2026-09-09' })).toEqual({ ok: false, error: { kind: 'PlacementTooOld' } }); // J61
    expect(ouvre({ placementDay: '2025-11-09' })).toEqual({ ok: false, error: { kind: 'PlacementTooOld' } }); // faute sur l'année
  });

  it('la durée prévue va de 1 à 60 jours, en jours entiers', () => {
    expect([ouvre({ plannedDuration: 1 }).ok, ouvre({ plannedDuration: 60 }).ok]).toEqual([true, true]);
    expect([ouvre({ plannedDuration: 0 }), ouvre({ plannedDuration: 61 }), ouvre({ plannedDuration: 44.5 })]).toEqual([
      { ok: false, error: { kind: 'InvalidPlannedDuration', value: 0 } },
      { ok: false, error: { kind: 'InvalidPlannedDuration', value: 61 } },
      { ok: false, error: { kind: 'InvalidPlannedDuration', value: 44.5 } },
    ]);
  });
});
