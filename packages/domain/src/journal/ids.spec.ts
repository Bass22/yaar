import { unwrap } from '@kit';
import { describe, expect, it } from 'vitest';
import {
  CampaignId,
  JournalEventId,
  OrderLineId,
  SiteId,
  TaskId,
  TenantId,
  UserId,
  WeighingRequestId,
} from './ids';

// Spec: CLAUDE.md §4 règle 2 — identifiants générés côté client (UUID) ; §8 — pas d'état invalide.
// Les refus à la compilation (`@ts-expect-error`) sont vérifiés par `npx nx typecheck domain`.

const A_UUID = '550e8400-e29b-41d4-a716-446655440000';
const ANOTHER_UUID = '0190a6c8-7b1e-7c3a-9f2d-3b5e8a1c4d6f';

describe('Identifiants typés', () => {
  it('un identifiant de site et un identifiant de campagne ne sont pas interchangeables', () => {
    // Given
    const site = unwrap(SiteId(A_UUID));
    const campaign = unwrap(CampaignId(ANOTHER_UUID));
    const openSite = (id: SiteId): string => id;

    // Then
    expect(openSite(site)).toBe(A_UUID);
    // @ts-expect-error une campagne n'est pas un site
    openSite(campaign);
    // @ts-expect-error un UUID non vérifié n'est pas un identifiant de site
    openSite(A_UUID);
  });

  it("un identifiant est l'UUID fourni par l'appelant, sans transformation", () => {
    // When
    const site = SiteId(A_UUID);

    // Then
    expect(site).toEqual({ ok: true, value: A_UUID });
  });

  it('toute version d’UUID est acceptée (v4 du navigateur, v7 ordonné dans le temps)', () => {
    for (const uuid of [A_UUID, ANOTHER_UUID]) {
      expect(CampaignId(uuid)).toEqual({ ok: true, value: uuid });
    }
  });

  it("ce qui n'est pas un UUID est refusé, avec le type d'identifiant attendu", () => {
    // Given
    const notUuids: unknown[] = [
      '',
      'site-1',
      '42',
      '550e8400e29b41d4a716446655440000',
      `{${A_UUID}}`,
      ` ${A_UUID}`,
      `${A_UUID}\n`,
      `${A_UUID}-0000`,
      'g50e8400-e29b-41d4-a716-446655440000',
      42,
      null,
      undefined,
      [A_UUID],
      { id: A_UUID },
    ];

    for (const raw of notUuids) {
      // Then
      expect(SiteId(raw)).toEqual({ ok: false, error: { kind: 'InvalidId', expected: 'SiteId' } });
      expect(CampaignId(raw)).toEqual({ ok: false, error: { kind: 'InvalidId', expected: 'CampaignId' } });
    }
  });

  it("un même UUID n'a qu'une écriture : les majuscules sont refusées", () => {
    // Idempotence par UUID (CLAUDE.md §4 règle 2) : deux écritures d'un même identifiant
    // seraient deux chaînes différentes, donc deux événements au lieu d'un doublon ignoré.
    expect(SiteId(A_UUID.toUpperCase())).toEqual({ ok: false, error: { kind: 'InvalidId', expected: 'SiteId' } });
  });

  it("chaque chose que le journal désigne a son type d'identifiant, nommé dans le refus", () => {
    const constructors = { CampaignId, JournalEventId, OrderLineId, SiteId, TaskId, TenantId, UserId, WeighingRequestId };

    for (const [expected, construct] of Object.entries(constructors)) {
      expect(construct(A_UUID)).toEqual({ ok: true, value: A_UUID });
      expect(construct('pas-un-uuid')).toEqual({ ok: false, error: { kind: 'InvalidId', expected } });
    }
  });

  it("l'auteur d'un événement n'est pas l'événement, ni le tenant", () => {
    // Given
    const author = unwrap(UserId(A_UUID));
    const sign = (id: UserId): string => id;

    // Then
    expect(sign(author)).toBe(A_UUID);
    // @ts-expect-error un événement n'est pas un utilisateur
    sign(unwrap(JournalEventId(A_UUID)));
    // @ts-expect-error un tenant n'est pas un utilisateur
    sign(unwrap(TenantId(A_UUID)));
  });

  it("un identifiant refusé est un résultat, jamais une exception", () => {
    expect(() => SiteId('pas-un-uuid')).not.toThrow();
  });
});
