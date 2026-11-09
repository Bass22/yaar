import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { unwrap, type Clock } from '@kit';
import { Instant } from '@domain/journal';
import type { CaretakerContext } from '@contracts';
import { AppModule } from '../app.module';
import { issueAccessToken, type SessionClaims } from '../auth/access-token';
import { CLOCK } from '../auth/auth.module';
import { APP_CONFIG } from '../config/app-config';
import { configureApp } from '../create-app';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';

// Spec: backlog O.2 — ouvrir une campagne ; cahier des charges « Ouvrir une bande » (décisions du
// 2026-11-09), « Hiérarchie » (plusieurs bandes en cours sur un site) ; CLAUDE.md §4 règles 2, 5,
// 6 et 14. PostgreSQL réel, HTTP.
jest.setTimeout(180_000);

const SECRET = 'un-secret-de-test-assez-long-pour-signer-des-jetons';
const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT_A = uuid(10);
const TENANT_B = uuid(11);
const NORD = uuid(3);
const SITE_DE_B = uuid(33);
const OUSMANE = uuid(51);
const LE_GERANT = uuid(54);
const ORDINATEUR = uuid(92);
const PIN_HASH = '$argon2id$v=19$m=19456,t=2,p=1$dGVzdC1vbmx5LXNhbHQ$dGVzdC1vbmx5LWRpZ2VzdC1ub3QtYS1yZWFsLXBpbg';

describe('Ouvrir une bande', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let origin: string;
  // Monday November 9th, 2026, 23:30 in Dakar (UTC+0): still the 9th on the site.
  const now = Date.parse('2026-11-09T23:30:00.000Z');
  const clock: Clock = { now: () => new Date(now) };

  const tokenOf = (sub: string, tenant: string, role: SessionClaims['role']) =>
    issueAccessToken({ sub, tenant, role, device: ORDINATEUR }, unwrap(Instant(new Date(now - 60_000).toISOString())), SECRET);
  const gerant = () => tokenOf(LE_GERANT, TENANT_A, 'admin');
  const ouvre = (body: unknown, token = gerant()) =>
    fetch(`${origin}/api/v1/campaigns`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const uneBande = (rank: number, fields: Record<string, unknown> = {}) => ({
    id: uuid(rank),
    siteId: NORD,
    strain: 'Cobb500',
    plannedHeadcount: 1000,
    placementDay: '2026-11-09',
    plannedDuration: 45,
    ...fields,
  });
  const campaignRow = (id: string) =>
    db.superuser.campaign.findUnique({ where: { id }, select: { tenantId: true, siteId: true, strain: true, plannedHeadcount: true, placementDay: true, plannedDuration: true, closedAt: true } });

  beforeAll(async () => {
    db = await createTestDatabase();
    await db.superuser.tenant.createMany({ data: [TENANT_A, TENANT_B].map((id) => ({ id, name: 'Ferme', currency: 'XOF' })) });
    await db.superuser.site.createMany({
      data: [
        { id: NORD, tenantId: TENANT_A, name: 'Poulailler Nord', timeZone: 'Africa/Dakar' },
        { id: SITE_DE_B, tenantId: TENANT_B, name: 'Chez B', timeZone: 'Africa/Dakar' },
      ],
    });
    await db.superuser.user.createMany({
      data: [
        { id: OUSMANE, tenantId: TENANT_A, role: 'collaborator', phone: '+221770000001', name: 'Ousmane', pinHash: PIN_HASH },
        { id: LE_GERANT, tenantId: TENANT_A, role: 'admin', phone: '+221770000002', name: 'Le gérant', pinHash: PIN_HASH },
      ],
    });
    await db.superuser.siteAssignment.create({ data: { tenantId: TENANT_A, siteId: NORD, userId: OUSMANE, isPrimary: true } });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue({ port: 0, databaseUrl: db.appUrl, jwtSecret: SECRET })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.listen(0, '127.0.0.1');
    origin = await app.getUrl();
  });

  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });

  it("l'admin ouvre une bande sur son site : souche, effectif prévu, mise en place, durée prévue ; l'ouverture est tracée", async () => {
    const response = await ouvre(uneBande(101));

    expect(response.status).toBe(201);
    expect(await campaignRow(uuid(101))).toEqual({
      tenantId: TENANT_A,
      siteId: NORD,
      strain: 'Cobb500',
      plannedHeadcount: 1000,
      placementDay: new Date('2026-11-09T00:00:00.000Z'),
      plannedDuration: 45,
      closedAt: null,
    });
    expect(await db.superuser.auditEvent.findMany({ where: { subjectId: uuid(101) }, select: { action: true, actorId: true, siteId: true, deviceId: true } })).toEqual([
      { action: 'CampaignOpened', actorId: LE_GERANT, siteId: NORD, deviceId: ORDINATEUR },
    ]);
  });

  it('la bande ouverte rejoint aussitôt le cahier du gardien du site, à côté des autres bandes en cours, au jour 0 et sans vivants inventés', async () => {
    await ouvre(uneBande(102, { placementDay: '2026-11-01' }));

    const context = (await (await fetch(`${origin}/api/v1/caretaker/context`, { headers: { Authorization: `Bearer ${tokenOf(OUSMANE, TENANT_A, 'collaborator')}` } })).json()) as CaretakerContext;

    expect(context.sites[0]?.campaigns.map(({ campaignId, campaignDay, liveCount }) => ({ campaignId, campaignDay, liveCount }))).toEqual(
      expect.arrayContaining([
        { campaignId: uuid(102), campaignDay: 8, liveCount: null },
        { campaignId: uuid(101), campaignDay: 0, liveCount: null },
      ]),
    );
  });

  it('les règles du domaine refusent (400, avec le motif) sans rien écrire : souche inconnue, effectif nul, date future ou trop ancienne, durée hors bornes', async () => {
    const refusals = [
      [uneBande(110, { strain: 'Ross308' }), 'UnknownStrain'],
      [uneBande(111, { plannedHeadcount: 0 }), 'InvalidQuantity'],
      [uneBande(112, { placementDay: '2026-11-10' }), 'PlacementInFuture'],
      [uneBande(113, { placementDay: '2026-09-09' }), 'PlacementTooOld'],
      [uneBande(114, { plannedDuration: 61 }), 'InvalidPlannedDuration'],
      [uneBande(115, { placementDay: '9 nov.' }), 'InvalidBusinessDay'],
    ] as const;

    for (const [body, kind] of refusals) {
      const response = await ouvre(body);
      expect([response.status, ((await response.json()) as { kind: string }).kind]).toEqual([400, kind]);
    }
    expect(await db.superuser.campaign.count({ where: { id: { in: refusals.map(([body]) => body.id) } } })).toBe(0);
  });

  it("un champ manquant ou en trop est refusé (400) — l'élevage vient de la session, et une bande ne s'ouvre pas déjà close", async () => {
    const sansEffectif: Record<string, unknown> = uneBande(120);
    delete sansEffectif['plannedHeadcount'];
    const statuses = await Promise.all([
      ouvre(sansEffectif),
      ouvre(uneBande(121, { tenantId: TENANT_B })),
      ouvre(uneBande(122, { closedAt: '2026-11-09T10:00:00.000Z' })),
      ouvre(uneBande(123, { plannedHeadcount: '1000' })),
      ouvre(uneBande(124, { id: 'pas-un-uuid' })),
    ]);

    expect(statuses.map((response) => response.status)).toEqual([400, 400, 400, 400, 400]);
    // Refused at the border, before the domain: a number written as text is not a number.
    expect(await statuses[3]?.json()).toEqual({ kind: 'InvalidRequest' });
    expect(await db.superuser.campaign.count({ where: { id: { in: [uuid(120), uuid(121), uuid(122), uuid(123)] } } })).toBe(0);
  });

  it("un identifiant déjà pris est refusé (409) sans toucher la bande existante ; le site d'un autre élevage n'existe pas (404)", async () => {
    expect((await ouvre(uneBande(101, { plannedHeadcount: 5 }))).status).toBe(409);
    expect((await campaignRow(uuid(101)))?.plannedHeadcount).toBe(1000);
    expect((await ouvre(uneBande(130, { siteId: SITE_DE_B }))).status).toBe(404);
    expect(await campaignRow(uuid(130))).toBeNull();
  });

  it("un gardien n'ouvre pas de bande (403)", async () => {
    expect((await ouvre(uneBande(140), tokenOf(OUSMANE, TENANT_A, 'collaborator'))).status).toBe(403);
  });
});
