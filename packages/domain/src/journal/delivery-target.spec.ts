import { unwrap } from '@kit';
import { describe, expect, it } from 'vitest';
import { validateDeliveryTarget, type DeliveryTarget } from './delivery-target';
import { CampaignId } from './ids';

// Spec: backlog Q.7 — à l'ingestion, une réception vise une ligne d'une commande annoncée, pas
// close, de la même bande ; cahier des charges « Commandes » (« On ne reçoit que sur une commande
// annoncée et pas close », Q.1) et « Livraison annoncée » (décision du 2026-11-11).

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const BANDE = unwrap(CampaignId(uuid(4)));
const AUTRE_BANDE = unwrap(CampaignId(uuid(5)));
const ligne = (fields: Partial<DeliveryTarget> = {}): DeliveryTarget => ({ campaignId: BANDE, announced: true, closed: false, ...fields });

describe('La ligne visée par une réception', () => {
  it('une ligne d’une commande annoncée, pas close, de la même bande reçoit', () => {
    expect(validateDeliveryTarget(BANDE, ligne())).toEqual({ ok: true, value: undefined });
  });

  it('une ligne inconnue, ou d’une autre bande, est refusée', () => {
    expect([validateDeliveryTarget(BANDE, null), validateDeliveryTarget(BANDE, ligne({ campaignId: AUTRE_BANDE }))]).toEqual([
      { ok: false, error: { kind: 'UnknownOrderLine' } },
      { ok: false, error: { kind: 'UnknownOrderLine' } },
    ]);
  });

  it('une commande en brouillon, ou close, ne reçoit pas', () => {
    expect([validateDeliveryTarget(BANDE, ligne({ announced: false })), validateDeliveryTarget(BANDE, ligne({ closed: true }))]).toEqual([
      { ok: false, error: { kind: 'OrderNotReceiving' } },
      { ok: false, error: { kind: 'OrderNotReceiving' } },
    ]);
  });
});
