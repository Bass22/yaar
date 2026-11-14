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
import { MorningReminders } from '../notifications/morning-reminders';
import { PUSH_SENDER, type PushSender } from '../notifications/site-notifications';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';

// Spec: backlog Q.15 — prévenir en une fois, ou déclarer des réceptions (décisions du fondateur du
// 2026-11-14) : en plusieurs fois, le gardien ne voit que des réceptions, à leur date ou en retard ;
// le matin de sa date à 7 h, chacune prévient les gardiens du site ; écrite pour aujourd'hui ou un
// jour passé, elle prévient tout de suite. PostgreSQL réel, HTTP ; le service du navigateur est un relevé.
jest.setTimeout(180_000);

const SECRET = 'un-secret-de-test-assez-long-pour-signer-des-jetons';
const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT = uuid(10);
const NORD = uuid(3);
const BANDE = uuid(4);
const SEDIMA = uuid(31);
const ALIMENT = uuid(41);
const COPEAUX = uuid(42);
const COMMANDE = uuid(20);
const LIGNE_ALIMENT = uuid(21);
const LIGNE_COPEAUX = uuid(22);
const OUSMANE = uuid(51);
const LE_GERANT = uuid(54);
const PIN_HASH = '$argon2id$v=19$m=19456,t=2,p=1$dGVzdC1vbmx5LXNhbHQ$dGVzdC1vbmx5LWRpZ2VzdC1ub3QtYS1yZWFsLXBpbg';

describe('Une commande reçue en plusieurs fois', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let origin: string;
  const sent: { title: string; body: string }[] = [];
  const sender: PushSender = async (_device, payload) => {
    sent.push({ title: payload.notification.title, body: payload.notification.body });
    return 'Delivered';
  };
  // Friday November 20th, 2026, 10:00 in Dakar.
  let now = new Date('2026-11-20T10:00:00.000Z');
  // A second passes at each reading: two writings of a reception never share their instant.
  let tick = 0;
  const clock: Clock = { now: () => new Date(now.getTime() + (tick += 1000)) };
  const tokenOf = (sub: string, role: SessionClaims['role']) => issueAccessToken({ sub, tenant: TENANT, role, device: uuid(sub === OUSMANE ? 91 : 92) }, unwrap(Instant(new Date(now.getTime() - 60_000).toISOString())), SECRET);
  const call = (method: string, path: string, body?: unknown, token = tokenOf(LE_GERANT, 'admin')) =>
    fetch(`${origin}/api/v1/${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const prevois = (receptionId: string, plannedOn: string, lines: { orderLineId: string; quantity: number }[]) => call('PUT', `orders/${COMMANDE}/receptions/${receptionId}`, { id: crypto.randomUUID(), plannedOn, lines });
  const attendu = async () => {
    const context = (await (await call('GET', 'caretaker/context', undefined, tokenOf(OUSMANE, 'collaborator'))).json()) as CaretakerContext;
    return (context.sites[0]?.campaigns[0]?.deliveries ?? []).flatMap(({ lines }) => lines.map(({ name, expected, received, remaining }) => ({ name, expected, received, remaining })));
  };
  /** What left once the requests answered: the sending happens after the commit. */
  const settled = async (count: number) => {
    for (let waited = 0; sent.length < count && waited < 5_000; waited += 20) await new Promise((resolve) => setTimeout(resolve, 20));
    await new Promise((resolve) => setTimeout(resolve, 150));
    return [...sent];
  };
  const pair = createECDH('prime256v1');
  pair.generateKeys();

  beforeAll(async () => {
    db = await createTestDatabase();
    await db.superuser.tenant.create({ data: { id: TENANT, name: 'Ferme', currency: 'XOF' } });
    await db.superuser.site.create({ data: { id: NORD, tenantId: TENANT, name: 'Poulailler Nord', timeZone: 'Africa/Dakar' } });
    await db.superuser.campaign.create({ data: { id: BANDE, tenantId: TENANT, siteId: NORD, placementDay: new Date('2026-11-01'), strain: 'Cobb500', plannedHeadcount: 1000, plannedDuration: 45 } });
    await db.superuser.user.createMany({
      data: [
        { id: OUSMANE, tenantId: TENANT, role: 'collaborator', phone: '+221770000001', name: 'Ousmane', pinHash: PIN_HASH },
        { id: LE_GERANT, tenantId: TENANT, role: 'admin', phone: '+221770000002', name: 'Le gérant', pinHash: PIN_HASH },
      ],
    });
    await db.superuser.siteAssignment.create({ data: { tenantId: TENANT, siteId: NORD, userId: OUSMANE, isPrimary: true } });
    await db.superuser.pushSubscription.create({ data: { tenantId: TENANT, deviceId: uuid(91), userId: OUSMANE, endpoint: 'https://fcm.googleapis.com/fcm/send/ousmane', p256dh: 'p', auth: 'a' } });
    await db.superuser.counterparty.create({ data: { id: SEDIMA, tenantId: TENANT, kind: 'Supplier', name: 'Sedima', face: 'closed-bag' } });
    await db.superuser.costType.createMany({
      data: [
        { id: ALIMENT, tenantId: TENANT, category: 'Feed', name: 'Aliment démarrage', behaviour: 'Variable', bagWeight: 50_000, feedStage: 'Starter' },
        { id: COPEAUX, tenantId: TENANT, category: 'Bedding', name: 'Copeaux', behaviour: 'Variable' },
      ],
    });
    // The order of the 10th, still a draft: 20 bags of feed, 20 bags of litter.
    await db.superuser.purchaseOrder.create({ data: { id: COMMANDE, tenantId: TENANT, supplierId: SEDIMA, campaignId: BANDE, orderDay: new Date('2026-11-10'), currency: 'XOF' } });
    await db.superuser.orderLine.createMany({
      data: [
        { id: LIGNE_ALIMENT, tenantId: TENANT, orderId: COMMANDE, position: 0, costTypeId: ALIMENT, quantity: 20, unitPrice: 18_000, bagWeight: 50_000 },
        { id: LIGNE_COPEAUX, tenantId: TENANT, orderId: COMMANDE, position: 1, costTypeId: COPEAUX, quantity: 20, unitPrice: 2_000 },
      ],
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue({ port: 0, databaseUrl: db.appUrl, jwtSecret: SECRET, mediaPath: '/data/medias', vapidPublicKey: pair.getPublicKey().toString('base64url'), vapidPrivateKey: pair.getPrivateKey().toString('base64url'), vapidSubject: 'mailto:contact@exemple.sn' })
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
  });

  it('« Déclarer des réceptions » : la première réception prévue annonce la commande, tracé — sans prévenir le gardien de la commande entière ; à venir, rien au cahier', async () => {
    expect((await prevois(uuid(101), '2026-11-25', [{ orderLineId: LIGNE_ALIMENT, quantity: 10 }])).status).toBe(204);

    expect((await db.superuser.purchaseOrder.findUniqueOrThrow({ where: { id: COMMANDE }, select: { announcedAt: true } })).announcedAt).not.toBeNull();
    expect(await db.superuser.auditEvent.count({ where: { action: 'OrderAnnounced', subjectId: COMMANDE } })).toBe(1);
    expect(await settled(1)).toEqual([]);
    expect(await attendu()).toEqual([]);
  });

  it('une réception prévue pour aujourd’hui prévient tout de suite, et le cahier n’attend qu’elle', async () => {
    expect((await prevois(uuid(102), '2026-11-20', [{ orderLineId: LIGNE_COPEAUX, quantity: 10 }])).status).toBe(204);

    expect(await settled(1)).toEqual([{ title: 'Une livraison est attendue', body: 'Poulailler Nord, aujourd’hui : Copeaux' }]);
    expect(await attendu()).toEqual([{ name: 'Copeaux', expected: 10, received: 0, remaining: 10 }]);
  });

  it('écrite pour un jour passé, elle prévient le jour où elle est écrite ; en retard, elle s’ajoute à ce qui est dû', async () => {
    expect((await prevois(uuid(103), '2026-11-18', [{ orderLineId: LIGNE_ALIMENT, quantity: 5 }, { orderLineId: LIGNE_COPEAUX, quantity: 5 }])).status).toBe(204);

    expect(await settled(1)).toEqual([{ title: 'Une livraison est attendue', body: 'Poulailler Nord, prévue le 18 novembre : Aliment démarrage, Copeaux' }]);
    // Dans l'ordre des lignes de la commande
    expect(await attendu()).toEqual([
      { name: 'Aliment démarrage', expected: 5, received: 0, remaining: 5 },
      { name: 'Copeaux', expected: 15, received: 0, remaining: 15 },
    ]);
  });

  it('reprogrammée à aujourd’hui, elle prévient ; écrite de nouveau le même jour, pas deux fois', async () => {
    expect((await prevois(uuid(101), '2026-11-20', [{ orderLineId: LIGNE_ALIMENT, quantity: 10 }])).status).toBe(204);
    expect(await settled(1)).toEqual([{ title: 'Une livraison est attendue', body: 'Poulailler Nord, aujourd’hui : Aliment démarrage' }]);

    sent.length = 0;
    expect((await prevois(uuid(101), '2026-11-19', [{ orderLineId: LIGNE_ALIMENT, quantity: 10 }])).status).toBe(204);
    expect(await settled(1)).toEqual([]);
  });

  it('ce que le gardien compte remplit les réceptions dues : le reste se recalcule', async () => {
    const reception = { siteId: NORD, campaignId: BANDE, businessDate: '2026-11-20', recordedAt: '2026-11-20T09:30:00.000Z', id: uuid(201), fact: { type: 'Delivery', orderLineId: LIGNE_ALIMENT, receivedQuantity: 12, deliveryNote: { kind: 'NoPaper' } } };
    const response = await call('POST', 'journal/events', { events: [reception] }, tokenOf(OUSMANE, 'collaborator'));
    expect(((await response.json()) as { outcomes: { status: string }[] }).outcomes[0]?.status).toBe('Accepted');

    // Aliment : 5 (le 18) + 10 (le 19) dus, 12 reçus → 3 restent
    expect(await attendu()).toEqual([
      { name: 'Aliment démarrage', expected: 15, received: 12, remaining: 3 },
      { name: 'Copeaux', expected: 15, received: 0, remaining: 15 },
    ]);
  });

  it('le matin de sa date, à 7 h, une réception prévient les gardiens du site, une seule fois', async () => {
    expect((await prevois(uuid(104), '2026-11-25', [{ orderLineId: LIGNE_COPEAUX, quantity: 5 }])).status).toBe(204);
    expect(await settled(1)).toEqual([]);

    // 6 h 55 : pas encore
    now = new Date('2026-11-25T06:55:00.000Z');
    await app.get(MorningReminders).remind();
    expect(sent.filter(({ title }) => title === 'Une livraison est attendue')).toEqual([]);

    now = new Date('2026-11-25T07:05:00.000Z');
    await app.get(MorningReminders).remind();
    await app.get(MorningReminders).remind();

    expect(sent.filter(({ title }) => title === 'Une livraison est attendue')).toEqual([{ title: 'Une livraison est attendue', body: 'Poulailler Nord, aujourd’hui : Copeaux' }]);
  });

  it('une réception déjà toute reçue ne prévient pas, même écrite pour un jour passé', async () => {
    // 40 sacs de copeaux comptés : ils couvrent toutes les réceptions de copeaux, celle écrite ensuite comprise
    const reception = { siteId: NORD, campaignId: BANDE, businessDate: '2026-11-25', recordedAt: '2026-11-25T08:00:00.000Z', id: uuid(202), fact: { type: 'Delivery', orderLineId: LIGNE_COPEAUX, receivedQuantity: 40, deliveryNote: { kind: 'NoPaper' } } };
    const response = await call('POST', 'journal/events', { events: [reception] }, tokenOf(OUSMANE, 'collaborator'));
    expect(((await response.json()) as { outcomes: { status: string }[] }).outcomes[0]?.status).toBe('Accepted');
    sent.length = 0;

    expect((await prevois(uuid(105), '2026-11-24', [{ orderLineId: LIGNE_COPEAUX, quantity: 5 }])).status).toBe(204);
    expect(await settled(1)).toEqual([]);
  });
});
