import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { unwrap, type Clock } from '@kit';
import { Instant } from '@domain/journal';
import type { SaleForecastsView } from '@contracts';
import { AppModule } from '../app.module';
import { issueAccessToken, type SessionClaims } from '../auth/access-token';
import { CLOCK } from '../auth/auth.module';
import { APP_CONFIG } from '../config/app-config';
import { configureApp } from '../create-app';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';

// Spec: backlog W.4 — les ventes prévues, acheteur par acheteur ; cahier des charges « Les ventes
// prévues » (décisions du fondateur du 2026-11-13). PostgreSQL réel, HTTP. Les montants à la main.
jest.setTimeout(180_000);

const SECRET = 'un-secret-de-test-assez-long-pour-signer-des-jetons';
const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT = uuid(10);
const NORD = uuid(3);
const BANDE = uuid(4);
const DEJA_CLOSE = uuid(5);
const MOUSSA = uuid(33);
const LE_LAGON = uuid(34);
const OUSMANE = uuid(51);
const LE_GERANT = uuid(54);
const ORDINATEUR = uuid(92);
const PIN_HASH = '$argon2id$v=19$m=19456,t=2,p=1$dGVzdC1vbmx5LXNhbHQ$dGVzdC1vbmx5LWRpZ2VzdC1ub3QtYS1yZWFsLXBpbg';

describe('Les ventes prévues, au bureau', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let origin: string;
  const now = Date.parse('2026-11-13T10:00:00.000Z');
  let tick = 0;
  const clock: Clock = { now: () => new Date(now + (tick += 1000)) };
  const tokenOf = (sub: string, role: SessionClaims['role']) => issueAccessToken({ sub, tenant: TENANT, role, device: ORDINATEUR }, unwrap(Instant(new Date(now - 60_000).toISOString())), SECRET);
  const call = (method: string, path: string, body?: unknown, token = tokenOf(LE_GERANT, 'admin')) =>
    fetch(`${origin}/api/v1/${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const prevois = (forecastId: string, fields: object = {}, campaignId = BANDE) =>
    call('PUT', `campaigns/${campaignId}/sale-forecasts/${forecastId}`, { id: crypto.randomUUID(), buyerId: MOUSSA, week: '2026-11-23', birds: 200, pricing: { kind: 'PerBird', price: 2_750 }, averageWeight: 2_200, ...fields });
  const lis = async () => (await (await call('GET', `campaigns/${BANDE}/sale-forecasts`)).json()) as SaleForecastsView;
  const refus = async (response: Response) => ({ status: response.status, kind: ((await response.json()) as { kind?: string }).kind });

  beforeAll(async () => {
    db = await createTestDatabase();
    await db.superuser.tenant.create({ data: { id: TENANT, name: 'Ferme', currency: 'XOF' } });
    await db.superuser.site.create({ data: { id: NORD, tenantId: TENANT, name: 'Poulailler Nord', timeZone: 'Africa/Dakar' } });
    await db.superuser.campaign.createMany({
      data: [
        { id: BANDE, tenantId: TENANT, siteId: NORD, placementDay: new Date('2026-10-12'), strain: 'Cobb500', plannedHeadcount: 1000, plannedDuration: 45 },
        { id: DEJA_CLOSE, tenantId: TENANT, siteId: NORD, placementDay: new Date('2026-07-01'), strain: 'Cobb500', plannedHeadcount: 1000, plannedDuration: 45, closedAt: new Date('2026-08-20T10:00:00.000Z') },
      ],
    });
    await db.superuser.user.createMany({
      data: [
        { id: OUSMANE, tenantId: TENANT, role: 'collaborator', phone: '+221770000001', name: 'Ousmane', pinHash: PIN_HASH },
        { id: LE_GERANT, tenantId: TENANT, role: 'admin', phone: '+221770000002', name: 'Le gérant', pinHash: PIN_HASH },
      ],
    });
    await db.superuser.counterparty.createMany({
      data: [
        { id: MOUSSA, tenantId: TENANT, kind: 'Customer', name: 'Moussa', face: 'caretaker' },
        { id: LE_LAGON, tenantId: TENANT, kind: 'Customer', name: 'Le Lagon', face: 'shop' },
      ],
    });
    // The budget of the flock: 900 000 F, over two posts
    await db.superuser.budgetLine.createMany({
      data: [
        { tenantId: TENANT, id: uuid(701), campaignId: BANDE, category: 'Feed', amount: 600_000, recordedAt: new Date('2026-10-12T08:00:00.000Z'), recordedBy: LE_GERANT },
        { tenantId: TENANT, id: uuid(702), campaignId: BANDE, category: 'Chicks', amount: 300_000, recordedAt: new Date('2026-10-12T08:00:00.000Z'), recordedBy: LE_GERANT },
      ],
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue({ port: 0, databaseUrl: db.appUrl, jwtSecret: SECRET, mediaPath: '/data/medias', vapidPublicKey: null })
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

  it('sans vente prévue : des recettes prévues à zéro, la marge prévue = − le budget, rien de réalisé', async () => {
    expect(await lis()).toMatchObject({ currency: 'XOF', forecasts: [], expectedRevenue: 0, budget: 900_000, expectedMargin: -900_000, realized: 0, closed: false });
  });

  it('deux ventes prévues, acheteur par acheteur, l’une par tête, l’autre au kilo : les recettes et la marge prévues ; c’est tracé', async () => {
    expect((await prevois(uuid(801))).status).toBe(204);
    // Le Lagon achète au kilo : 300 poulets de 2,2 kg prévus, à 1 200 F le kilo
    expect((await prevois(uuid(802), { buyerId: LE_LAGON, week: '2026-11-25', birds: 300, pricing: { kind: 'PerKilo', price: 1_200 }, averageWeight: 2_200 })).status).toBe(204);

    // 200 × 2 750 + 300 × 2,2 kg × 1 200 = 550 000 + 792 000 = 1 342 000 F ; marge 1 342 000 − 900 000 = 442 000 F
    expect(await lis()).toMatchObject({
      forecasts: [
        { forecastId: uuid(801), buyerId: MOUSSA, week: '2026-11-23', birds: 200, pricing: { kind: 'PerBird', price: 2_750 }, averageWeight: 2_200, expectedRevenue: 550_000 },
        { forecastId: uuid(802), buyerId: LE_LAGON, week: '2026-11-25', birds: 300, pricing: { kind: 'PerKilo', price: 1_200 }, averageWeight: 2_200, expectedRevenue: 792_000 },
      ],
      expectedRevenue: 1_342_000,
      expectedMargin: 442_000,
    });
    expect(await db.superuser.auditEvent.count({ where: { action: 'SaleForecastRecorded', actorId: LE_GERANT } })).toBe(2);
  });

  it('modifier une vente prévue écrit une ligne de plus — la dernière fait foi, rien n’est effacé ; la retirer aussi', async () => {
    expect((await prevois(uuid(801), { birds: 250 })).status).toBe(204);
    expect((await lis()).forecasts.find(({ forecastId }) => forecastId === uuid(801))?.birds).toBe(250);
    expect((await call('POST', `campaigns/${BANDE}/sale-forecasts/${uuid(802)}/withdraw`, { id: crypto.randomUUID() })).status).toBe(204);

    // 250 × 2 750 = 687 500 F, seule
    expect(await lis()).toMatchObject({ forecasts: [{ forecastId: uuid(801), birds: 250 }], expectedRevenue: 687_500, expectedMargin: -212_500 });
    expect(await db.superuser.saleForecast.count()).toBe(4);
    expect(await db.superuser.auditEvent.count({ where: { action: 'SaleForecastWithdrawn' } })).toBe(1);
  });

  it('le réalisé se lit à côté : le chiffre d’affaires des ventes faites ; une vente prévue n’est jamais une créance', async () => {
    const vente = { id: uuid(901), campaignId: BANDE, buyerId: MOUSSA, soldOn: '2026-11-12', birds: 100, pricing: { kind: 'PerBird', unitPrice: 2_700 }, receivedNow: null };
    expect((await call('POST', 'sales', vente)).status).toBe(201);

    expect((await lis()).realized).toBe(270_000);
    // Moussa doit la vente faite (270 000), pas la vente prévue
    const livre = (await (await call('GET', 'ledger')).json()) as { counterparties: { counterpartyId: string; balance: number }[] };
    expect(livre.counterparties.find(({ counterpartyId }) => counterpartyId === MOUSSA)?.balance).toBe(270_000);
  });

  it('les règles du domaine refusent (400) ; une bande close n’en prend plus (409) ; une bande inconnue n’existe pas (404)', async () => {
    expect(await refus(await prevois(uuid(803), { birds: 0 }))).toEqual({ status: 400, kind: 'InvalidBirds' });
    expect(await refus(await prevois(uuid(803), { buyerId: uuid(99) }))).toEqual({ status: 400, kind: 'UnknownBuyer' });
    expect(await refus(await prevois(uuid(803), { week: '2026-10-01' }))).toEqual({ status: 400, kind: 'WeekBeforePlacement' });
    expect(await refus(await prevois(uuid(803), { pricing: { kind: 'PerKilo', price: 1_200 }, averageWeight: null }))).toEqual({ status: 400, kind: 'MissingWeight' });
    expect(await refus(await prevois(uuid(803), {}, DEJA_CLOSE))).toEqual({ status: 409, kind: 'CampaignClosed' });
    expect((await prevois(uuid(803), {}, uuid(98))).status).toBe(404);
    expect(await refus(await call('PUT', `campaigns/${BANDE}/sale-forecasts/${uuid(803)}`, { id: crypto.randomUUID(), buyerId: MOUSSA }))).toEqual({ status: 400, kind: 'InvalidRequest' });
  });

  it('le gardien ne lit ni n’écrit aucune vente prévue (403)', async () => {
    expect((await call('GET', `campaigns/${BANDE}/sale-forecasts`, undefined, tokenOf(OUSMANE, 'collaborator'))).status).toBe(403);
  });
});
