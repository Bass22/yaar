import { createECDH } from 'node:crypto';
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
import { PUSH_SENDER, type PushSender } from './site-notifications';
import type { PushOutcome } from './web-push';

// Spec: backlog Y.2a — une livraison annoncée et une demande de pesée préviennent les gardiens du
// site ; cahier des charges « Notifications push » (Envoyer). PostgreSQL réel, HTTP ; le service
// de notification du navigateur est remplacé par un relevé de ce qui part.
jest.setTimeout(180_000);

const SECRET = 'un-secret-de-test-assez-long-pour-signer-des-jetons';
const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT = uuid(10);
const NORD = uuid(3);
const SUD = uuid(30);
const BANDE = uuid(4);
const SEDIMA = uuid(31);
const ALIMENT = uuid(41);
const COPEAUX = uuid(42);
const OUSMANE = uuid(51);
const AWA = uuid(52);
const MODOU = uuid(53);
const LE_GERANT = uuid(54);
const ORDINATEUR = uuid(92);
const PIN_HASH = '$argon2id$v=19$m=19456,t=2,p=1$dGVzdC1vbmx5LXNhbHQ$dGVzdC1vbmx5LWRpZ2VzdC1ub3QtYS1yZWFsLXBpbg';
const endpointOf = (who: string) => `https://fcm.googleapis.com/fcm/send/${who}`;

function vapidKeys() {
  const pair = createECDH('prime256v1');
  pair.generateKeys();
  return { vapidPublicKey: pair.getPublicKey().toString('base64url'), vapidPrivateKey: pair.getPrivateKey().toString('base64url'), vapidSubject: 'mailto:contact@exemple.sn' };
}

describe('Les gardiens du site sont prévenus', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let origin: string;
  const sent: { endpoint: string; payload: unknown }[] = [];
  let answer: (endpoint: string) => PushOutcome | 'throw' = () => 'Delivered';
  const sender: PushSender = async (device, payload) => {
    const outcome = answer(device.endpoint);
    if (outcome === 'throw') throw new Error('le service ne répond pas');
    sent.push({ endpoint: device.endpoint, payload });
    return outcome;
  };
  const now = Date.parse('2026-11-14T10:00:00.000Z');
  let tick = 0;
  const clock: Clock = { now: () => new Date(now + (tick += 1000)) };
  const tokenOf = (sub: string, role: SessionClaims['role']) => issueAccessToken({ sub, tenant: TENANT, role, device: ORDINATEUR }, unwrap(Instant(new Date(now - 60_000).toISOString())), SECRET);
  const call = (method: string, path: string, body?: unknown, token = tokenOf(LE_GERANT, 'admin')) =>
    fetch(`${origin}/api/v1/${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  /** What left once the requests answered: the sending happens after the commit, out of the request. */
  const settled = async (count: number) => {
    for (let waited = 0; sent.length < count && waited < 5_000; waited += 20) await new Promise((resolve) => setTimeout(resolve, 20));
    await new Promise((resolve) => setTimeout(resolve, 150));
    return sent.map(({ endpoint }) => endpoint);
  };
  let rank = 200;
  const uneCommande = async () => {
    const id = uuid((rank += 1));
    await db.superuser.purchaseOrder.create({ data: { id, tenantId: TENANT, supplierId: SEDIMA, campaignId: BANDE, orderDay: new Date('2026-11-13'), currency: 'XOF' } });
    await db.superuser.orderLine.createMany({
      data: [
        { id: uuid((rank += 1)), tenantId: TENANT, orderId: id, position: 0, costTypeId: ALIMENT, quantity: 20, unitPrice: 18_000, bagWeight: 50_000 },
        { id: uuid((rank += 1)), tenantId: TENANT, orderId: id, position: 1, costTypeId: COPEAUX, quantity: 10, unitPrice: 2_250 },
      ],
    });
    return id;
  };

  beforeAll(async () => {
    db = await createTestDatabase();
    await db.superuser.tenant.create({ data: { id: TENANT, name: 'Ferme', currency: 'XOF' } });
    await db.superuser.site.createMany({ data: [{ id: NORD, tenantId: TENANT, name: 'Poulailler Nord', timeZone: 'Africa/Dakar' }, { id: SUD, tenantId: TENANT, name: 'Poulailler Sud', timeZone: 'Africa/Dakar' }] });
    await db.superuser.campaign.create({ data: { id: BANDE, tenantId: TENANT, siteId: NORD, placementDay: new Date('2026-11-01'), strain: 'Cobb500', plannedHeadcount: 1000, plannedDuration: 45 } });
    await db.superuser.user.createMany({
      data: [
        { id: OUSMANE, tenantId: TENANT, role: 'collaborator', phone: '+221770000001', name: 'Ousmane', pinHash: PIN_HASH },
        { id: AWA, tenantId: TENANT, role: 'collaborator', phone: '+221770000003', name: 'Awa', pinHash: PIN_HASH },
        { id: MODOU, tenantId: TENANT, role: 'collaborator', phone: '+221770000004', name: 'Modou', pinHash: PIN_HASH },
        { id: LE_GERANT, tenantId: TENANT, role: 'admin', phone: '+221770000002', name: 'Le gérant', pinHash: PIN_HASH },
      ],
    });
    // Ousmane and Modou keep the north; Awa the south.
    await db.superuser.siteAssignment.createMany({
      data: [
        { tenantId: TENANT, siteId: NORD, userId: OUSMANE, isPrimary: true },
        { tenantId: TENANT, siteId: NORD, userId: MODOU, isPrimary: false },
        { tenantId: TENANT, siteId: SUD, userId: AWA, isPrimary: true },
      ],
    });
    await db.superuser.pushSubscription.createMany({
      data: [
        { tenantId: TENANT, deviceId: uuid(91), userId: OUSMANE, endpoint: endpointOf('ousmane'), p256dh: 'p', auth: 'a' },
        { tenantId: TENANT, deviceId: uuid(93), userId: MODOU, endpoint: endpointOf('modou'), p256dh: 'p', auth: 'a' },
        { tenantId: TENANT, deviceId: uuid(94), userId: AWA, endpoint: endpointOf('awa'), p256dh: 'p', auth: 'a' },
        { tenantId: TENANT, deviceId: ORDINATEUR, userId: LE_GERANT, endpoint: endpointOf('gerant'), p256dh: 'p', auth: 'a' },
      ],
    });
    await db.superuser.counterparty.create({ data: { id: SEDIMA, tenantId: TENANT, kind: 'Supplier', name: 'Sedima', face: 'closed-bag' } });
    await db.superuser.costType.createMany({
      data: [
        { id: ALIMENT, tenantId: TENANT, category: 'Feed', name: 'Aliment démarrage', behaviour: 'Variable', bagWeight: 50_000, feedStage: 'Starter' },
        { id: COPEAUX, tenantId: TENANT, category: 'Bedding', name: 'Copeaux', behaviour: 'Variable' },
      ],
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue({ port: 0, databaseUrl: db.appUrl, jwtSecret: SECRET, mediaPath: '/data/medias', ...vapidKeys() })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .overrideProvider(PUSH_SENDER)
      .useValue(sender)
      .compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.listen(0, '127.0.0.1');
    origin = await app.getUrl();
  });

  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });

  beforeEach(() => {
    sent.length = 0;
    answer = () => 'Delivered';
  });

  it('une livraison annoncée prévient les gardiens du site — ni l’autre site, ni l’admin — avec le site et ce qui arrive, jamais un montant', async () => {
    expect((await call('POST', `orders/${await uneCommande()}/announce`)).status).toBe(204);

    expect((await settled(2)).sort()).toEqual([endpointOf('modou'), endpointOf('ousmane')]);
    expect(sent[0]?.payload).toEqual({
      notification: {
        title: 'Une livraison est annoncée',
        body: 'Poulailler Nord : Aliment démarrage, Copeaux',
        icon: '/icons/app-icon-192.png',
        tag: 'delivery',
        // Y.4 : un tap ouvre l'application sur la carte, même fermée — l'adresse vient de la liste fermée des sortes
        data: { kind: 'DeliveryAnnounced', campaignId: BANDE, onActionClick: { default: { operation: 'navigateLastFocusedOrOpen', url: `/notification?kind=DeliveryAnnounced&campaign=${BANDE}` } } },
      },
    });
    const words = JSON.stringify(sent.map(({ payload }) => payload));
    for (const money of ['18000', '18 000', '2250', '2 250', 'FCFA', 'XOF', 'prix']) expect(words).not.toContain(money);
  });

  it('une demande de pesée prévient les gardiens du site, avec le jour demandé ; la même demande renvoyée ne prévient pas deux fois', async () => {
    const request = { id: uuid(301), campaignId: BANDE, requestedFor: '2026-11-21' };
    expect((await call('POST', 'weighing-requests', request)).status).toBe(201);
    expect((await call('POST', 'weighing-requests', request)).status).toBe(200);

    expect((await settled(2)).sort()).toEqual([endpointOf('modou'), endpointOf('ousmane')]);
    expect(sent[0]?.payload).toMatchObject({ notification: { title: 'Le chef demande une pesée', body: 'Poulailler Nord, le 21 novembre', tag: 'weighing', data: { kind: 'WeighingRequested', campaignId: BANDE } } });
  });

  it('une annonce refusée ne prévient personne : seul ce qui est enregistré part', async () => {
    const order = await uneCommande();
    await call('POST', `orders/${order}/announce`);
    await settled(2);
    sent.length = 0;

    expect((await call('POST', `orders/${order}/announce`)).status).toBe(409);
    expect(await settled(1)).toEqual([]);
  });

  it('le push échoue : l’annonce est enregistrée quand même, et la carte est dans le cahier du gardien', async () => {
    answer = () => 'throw';
    const order = await uneCommande();

    expect((await call('POST', `orders/${order}/announce`)).status).toBe(204);
    await settled(1);
    const context = (await (await call('GET', 'caretaker/context', undefined, tokenOf(OUSMANE, 'collaborator'))).json()) as CaretakerContext;
    expect(context.sites[0]?.campaigns[0]?.deliveries.map(({ orderId }) => orderId)).toContain(order);
  });

  it('un abonnement que le service dit disparu est supprimé ; les autres restent', async () => {
    answer = (endpoint) => (endpoint === endpointOf('modou') ? 'Gone' : 'Delivered');

    await call('POST', `orders/${await uneCommande()}/announce`);
    await settled(2);
    for (let waited = 0; waited < 3_000 && (await db.superuser.pushSubscription.count({ where: { userId: MODOU } })) > 0; waited += 50) await new Promise((resolve) => setTimeout(resolve, 50));

    expect((await db.superuser.pushSubscription.findMany({ select: { userId: true } })).map(({ userId }) => userId).sort()).toEqual([OUSMANE, AWA, LE_GERANT].sort());
  });

  it('sans clés configurées, rien ne part — et l’annonce est enregistrée comme d’habitude', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue({ port: 0, databaseUrl: db.appUrl, jwtSecret: SECRET, mediaPath: '/data/medias', vapidPublicKey: null, vapidPrivateKey: null, vapidSubject: null })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .overrideProvider(PUSH_SENDER)
      .useValue(sender)
      .compile();
    const without = configureApp(moduleRef.createNestApplication());
    await without.listen(0, '127.0.0.1');
    try {
      const response = await fetch(`${await without.getUrl()}/api/v1/orders/${await uneCommande()}/announce`, { method: 'POST', headers: { Authorization: `Bearer ${tokenOf(LE_GERANT, 'admin')}` } });
      expect(response.status).toBe(204);
      expect(await settled(1)).toEqual([]);
    } finally {
      await without.close();
    }
  });
});
