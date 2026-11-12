import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { unwrap, type Clock } from '@kit';
import { Instant } from '@domain/journal';
import type { TrackingView } from '@contracts';
import { AppModule } from '../app.module';
import { issueAccessToken, type SessionClaims } from '../auth/access-token';
import { CLOCK } from '../auth/auth.module';
import { APP_CONFIG } from '../config/app-config';
import { configureApp } from '../create-app';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';

// Spec: backlog V.3 — les indicateurs du suivi ; cahier des charges « L'onglet Suivi d'un lot » et
// « La consommation d'aliment » (V.1) ; CLAUDE.md §4 règles 4, 5 et 8 (projections recalculées).
// PostgreSQL réel, HTTP. Les nombres attendus sont calculés à la main.
jest.setTimeout(180_000);

const SECRET = 'un-secret-de-test-assez-long-pour-signer-des-jetons';
const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT = uuid(10);
const AUTRE_ELEVAGE = uuid(11);
const NORD = uuid(3);
const BANDE = uuid(4);
const BANDE_VIDE = uuid(5);
const BANDE_AILLEURS = uuid(6);
const SEDIMA = uuid(31);
const MOUSSA = uuid(33);
const POUSSINS = uuid(42);
const DEMANDE = uuid(70);
const OUSMANE = uuid(51);
const LE_GERANT = uuid(54);
const ORDINATEUR = uuid(92);
const PIN_HASH = '$argon2id$v=19$m=19456,t=2,p=1$dGVzdC1vbmx5LXNhbHQ$dGVzdC1vbmx5LWRpZ2VzdC1ub3QtYS1yZWFsLXBpbg';

describe('Le suivi d’un lot, au bureau', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let origin: string;
  // Wednesday November 4th, 2026, 10:00 in Dakar: day 23 of a flock placed on October 12th.
  const now = Date.parse('2026-11-04T10:00:00.000Z');
  let tick = 0;
  const clock: Clock = { now: () => new Date(now + (tick += 1000)) };
  const tokenOf = (sub: string, role: SessionClaims['role'], tenant = TENANT) => issueAccessToken({ sub, tenant, role, device: ORDINATEUR }, unwrap(Instant(new Date(now - 60_000).toISOString())), SECRET);
  const call = (method: string, path: string, body?: unknown, token = tokenOf(LE_GERANT, 'admin')) =>
    fetch(`${origin}/api/v1/${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const suivi = async (campaignId = BANDE) => (await (await call('GET', `campaigns/${campaignId}/tracking`)).json()) as TrackingView;

  beforeAll(async () => {
    db = await createTestDatabase();
    await db.superuser.tenant.createMany({ data: [{ id: TENANT, name: 'Ferme', currency: 'XOF' }, { id: AUTRE_ELEVAGE, name: 'Ailleurs', currency: 'XOF' }] });
    await db.superuser.site.createMany({ data: [{ id: NORD, tenantId: TENANT, name: 'Poulailler Nord', timeZone: 'Africa/Dakar' }, { id: uuid(7), tenantId: AUTRE_ELEVAGE, name: 'Là-bas', timeZone: 'Africa/Dakar' }] });
    await db.superuser.campaign.createMany({
      data: [
        { id: BANDE, tenantId: TENANT, siteId: NORD, placementDay: new Date('2026-10-12'), strain: 'Cobb500', plannedHeadcount: 1000, plannedDuration: 45 },
        { id: BANDE_VIDE, tenantId: TENANT, siteId: NORD, placementDay: new Date('2026-11-04'), strain: 'Cobb500', plannedHeadcount: 500, plannedDuration: 42 },
        { id: BANDE_AILLEURS, tenantId: AUTRE_ELEVAGE, siteId: uuid(7), placementDay: new Date('2026-10-12'), strain: 'Cobb500', plannedHeadcount: 1000, plannedDuration: 45 },
      ],
    });
    await db.superuser.user.createMany({
      data: [
        { id: OUSMANE, tenantId: TENANT, role: 'collaborator', phone: '+221770000001', name: 'Ousmane', pinHash: PIN_HASH },
        { id: LE_GERANT, tenantId: TENANT, role: 'admin', phone: '+221770000002', name: 'Le gérant', pinHash: PIN_HASH },
      ],
    });
    await db.superuser.siteAssignment.create({ data: { tenantId: TENANT, siteId: NORD, userId: OUSMANE, isPrimary: true } });
    await db.superuser.counterparty.createMany({
      data: [
        { id: SEDIMA, tenantId: TENANT, kind: 'Supplier', name: 'Sedima', face: 'closed-bag' },
        { id: MOUSSA, tenantId: TENANT, kind: 'Customer', name: 'Moussa', face: 'hen' },
      ],
    });
    await db.superuser.costType.create({ data: { id: POUSSINS, tenantId: TENANT, category: 'Chicks', name: 'Poussins', behaviour: 'Variable' } });
    // 1 000 chicks ordered and received at 550 F: 550 000 F committed.
    await db.superuser.purchaseOrder.create({ data: { id: uuid(20), tenantId: TENANT, supplierId: SEDIMA, campaignId: BANDE, orderDay: new Date('2026-10-12'), currency: 'XOF', announcedAt: new Date('2026-10-12T09:00:00.000Z') } });
    await db.superuser.orderLine.create({ data: { id: uuid(21), tenantId: TENANT, orderId: uuid(20), position: 0, costTypeId: POUSSINS, quantity: 1000, unitPrice: 550 } });
    await db.superuser.weighingRequest.create({ data: { id: DEMANDE, tenantId: TENANT, campaignId: BANDE, requestedFor: new Date('2026-11-02'), requestedBy: LE_GERANT } });
    const on = (day: string, rank: number) => ({ businessDate: new Date(day), recordedAt: new Date(`${day}T18:${String(rank % 60).padStart(2, '0')}:00.000Z`) });
    const event = (rank: number, day: string, type: 'Delivery' | 'BagOpened' | 'Death' | 'Weighing' | 'WeighingValidated', fact: { [key: string]: string | number | number[] | { kind: string } }) => ({ id: uuid(rank), tenantId: TENANT, siteId: NORD, campaignId: BANDE, authorId: OUSMANE, deviceId: uuid(93), type, fact, ...on(day, rank) });
    await db.superuser.journalEvent.createMany({
      data: [
        event(201, '2026-10-12', 'Delivery', { orderLineId: uuid(21), receivedQuantity: 1000, deliveryNote: { kind: 'NoPaper' } }),
        event(202, '2026-10-12', 'BagOpened', { quantity: 2 }),
        event(203, '2026-10-17', 'Death', { quantity: 40 }),
        event(204, '2026-10-22', 'BagOpened', { quantity: 10 }),
        event(205, '2026-11-01', 'BagOpened', { quantity: 6 }),
        event(206, '2026-11-01', 'Death', { quantity: 22 }),
        event(207, '2026-11-02', 'Weighing', { weighingRequestId: DEMANDE, weights: [840, 850, 860, 830, 870] }),
        { ...event(208, '2026-11-02', 'WeighingValidated', { weighingId: uuid(207) }), authorId: LE_GERANT },
      ],
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue({ port: 0, databaseUrl: db.appUrl, jwtSecret: SECRET, mediaPath: '/data/medias' })
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

  it('les chiffres du suivi, chacun recalculé : coût par poulet, mortalité, jours, aliment, indice, courbe ; pas de ventes avant la première', async () => {
    // Vivants : 1 000 − 40 − 22 = 938. Coût par poulet : 550 000 ÷ min(938, 1 000 × 93 % = 930) = 591,4 → 591 F.
    // Mortalité : 62 ÷ 1 000 = 0,062. Aujourd'hui J23 sur 45.
    // Aliment : J0 2 sacs ÷ 1 000 = 100 g ; J10 10 sacs ÷ 960 = 520,83 g ; J20 6 sacs ÷ 960 (les 22 morts de J20 comptent dès J21) = 312,5 g ;
    // cumul 933,33 → 933 g, contre 1 301 g dans la table à J23 : −368 g. Indice à J21 : 933 ÷ 850 (moyenne) = 1,098, contre 1,261.
    expect(await suivi()).toEqual({
      campaignId: BANDE,
      currency: 'XOF',
      strain: 'Cobb500',
      campaignDay: 23,
      plannedDuration: 45,
      costPerBird: 591,
      received: 1000,
      deaths: 62,
      mortality: 0.062,
      feed: { bagsOpened: 18, cumulative: 933, target: 1301, variance: -368, feedConversion: { campaignDay: 21, value: 1.098, target: 1.261 } },
      curve: [{ weighingId: uuid(207), campaignDay: 21, average: 850 }],
      sales: null,
    });
  });

  it('dès la première vente : marge, prix moyen et restant à vendre ; les poulets vendus aujourd’hui ne changent pas l’aliment déjà mangé', async () => {
    // Given 100 poulets vendus aujourd'hui à 2 000 F, 200 000 F reçus
    const vente = { id: uuid(301), campaignId: BANDE, buyerId: MOUSSA, soldOn: '2026-11-04', birds: 100, pricing: { kind: 'PerBird', unitPrice: 2_000 }, receivedNow: { id: uuid(302), amount: 200_000, method: 'Cash' } };
    expect((await call('POST', 'sales', vente)).status).toBe(201);

    // Then marge 200 000 − 550 000 = −350 000 F ; prix moyen 2 000 F ; restant 938 − 100 = 838
    const view = await suivi();
    expect(view.sales).toEqual({ margin: -350_000, averagePrice: 2_000, remaining: 838 });
    expect(view.feed.cumulative).toBe(933);
  });

  it('des poulets vendus un jour passé sortent des vivants dès le lendemain : l’aliment des jours suivants se divise par moins', async () => {
    // Given 460 poulets vendus le 25 octobre (J13), à crédit
    const vente = { id: uuid(303), campaignId: BANDE, buyerId: MOUSSA, soldOn: '2026-10-25', birds: 460, pricing: { kind: 'PerBird', unitPrice: 2_000 }, receivedNow: null };
    expect((await call('POST', 'sales', vente)).status).toBe(201);

    // Then à J20 il reste 1 000 − 40 − 460 = 500 vivants : 6 sacs ÷ 500 = 600 g ;
    // cumul 100 + 520,83 + 600 = 1 220,83 → 1 221 g ; écart 1 221 − 1 301 = −80 g
    expect((await suivi()).feed).toMatchObject({ cumulative: 1221, variance: -80 });
  });

  it('un lot sans rien encore : chaque chiffre sans donnée est absent, jamais zéro', async () => {
    expect(await suivi(BANDE_VIDE)).toEqual({
      campaignId: BANDE_VIDE,
      currency: 'XOF',
      strain: 'Cobb500',
      campaignDay: 0,
      plannedDuration: 42,
      costPerBird: null,
      received: 0,
      deaths: 0,
      mortality: null,
      feed: { bagsOpened: 0, cumulative: null, target: null, variance: null, feedConversion: null },
      curve: [],
      sales: null,
    });
  });

  it('un lot inconnu, ou d’un autre élevage, n’existe pas (404) ; un identifiant mal formé non plus', async () => {
    expect((await call('GET', `campaigns/${BANDE_AILLEURS}/tracking`)).status).toBe(404);
    expect((await call('GET', `campaigns/${uuid(999)}/tracking`)).status).toBe(404);
    expect((await call('GET', 'campaigns/pas-un-uuid/tracking')).status).toBe(404);
  });

  it('un gardien ne lit pas le suivi : il porte de l’argent (403)', async () => {
    expect((await call('GET', `campaigns/${BANDE}/tracking`, undefined, tokenOf(OUSMANE, 'collaborator'))).status).toBe(403);
  });
});
