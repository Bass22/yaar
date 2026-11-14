import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { unwrap, type Clock } from '@kit';
import { Instant } from '@domain/journal';
import type { ReceptionsView } from '@contracts';
import { AppModule } from '../app.module';
import { issueAccessToken, type SessionClaims } from '../auth/access-token';
import { CLOCK } from '../auth/auth.module';
import { APP_CONFIG } from '../config/app-config';
import { configureApp } from '../create-app';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';

// Spec: backlog Q.14 — les réceptions prévues ; cahier des charges « Les réceptions prévues »
// (décisions du fondateur du 2026-11-13). PostgreSQL réel, HTTP ; les réceptions du gardien viennent du journal.
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
const ORDINATEUR = uuid(92);
const PIN_HASH = '$argon2id$v=19$m=19456,t=2,p=1$dGVzdC1vbmx5LXNhbHQ$dGVzdC1vbmx5LWRpZ2VzdC1ub3QtYS1yZWFsLXBpbg';

describe('Les réceptions prévues, au bureau', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let origin: string;
  // Friday the 20th of November 2026, in Dakar.
  const now = Date.parse('2026-11-20T10:00:00.000Z');
  let tick = 0;
  const clock: Clock = { now: () => new Date(now + (tick += 1000)) };
  const tokenOf = (sub: string, role: SessionClaims['role']) => issueAccessToken({ sub, tenant: TENANT, role, device: ORDINATEUR }, unwrap(Instant(new Date(now - 60_000).toISOString())), SECRET);
  const call = (method: string, path: string, body?: unknown, token = tokenOf(LE_GERANT, 'admin')) =>
    fetch(`${origin}/api/v1/${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const prevois = (receptionId: string, plannedOn: string, lines: { orderLineId: string; quantity: number }[], orderId = COMMANDE) => call('PUT', `orders/${orderId}/receptions/${receptionId}`, { id: crypto.randomUUID(), plannedOn, lines });
  const lis = async () => (await (await call('GET', 'receptions')).json()) as ReceptionsView;
  const refus = async (response: Response) => ({ status: response.status, kind: ((await response.json()) as { kind?: string }).kind });

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
    await db.superuser.counterparty.create({ data: { id: SEDIMA, tenantId: TENANT, kind: 'Supplier', name: 'Sedima', face: 'closed-bag' } });
    await db.superuser.costType.createMany({
      data: [
        { id: ALIMENT, tenantId: TENANT, category: 'Feed', name: 'Aliment démarrage', behaviour: 'Variable', bagWeight: 50_000 },
        { id: COPEAUX, tenantId: TENANT, category: 'Bedding', name: 'Copeaux', behaviour: 'Variable' },
      ],
    });
    // The order of the 10th: 20 bags of feed, 20 bags of litter, announced.
    await db.superuser.purchaseOrder.create({ data: { id: COMMANDE, tenantId: TENANT, supplierId: SEDIMA, campaignId: BANDE, orderDay: new Date('2026-11-10'), currency: 'XOF', announcedAt: new Date('2026-11-10T09:00:00.000Z') } });
    await db.superuser.orderLine.createMany({
      data: [
        { id: LIGNE_ALIMENT, tenantId: TENANT, orderId: COMMANDE, position: 0, costTypeId: ALIMENT, quantity: 20, unitPrice: 18_000, bagWeight: 50_000 },
        { id: LIGNE_COPEAUX, tenantId: TENANT, orderId: COMMANDE, position: 1, costTypeId: COPEAUX, quantity: 20, unitPrice: 2_000 },
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

  it('une commande reçue en une fois ne demande rien : sans réception prévue, la liste est vide', async () => {
    expect(await lis()).toEqual({ today: '2026-11-20', receptions: [] });
  });

  it('deux réceptions prévues — le 15 : 10 sacs d’aliment et 10 de copeaux ; le 25 : 10 sacs d’aliment — suivies selon ce que le gardien a reçu ; c’est tracé', async () => {
    expect((await prevois(uuid(101), '2026-11-15', [{ orderLineId: LIGNE_ALIMENT, quantity: 10 }, { orderLineId: LIGNE_COPEAUX, quantity: 10 }])).status).toBe(204);
    expect((await prevois(uuid(102), '2026-11-25', [{ orderLineId: LIGNE_ALIMENT, quantity: 10 }])).status).toBe(204);
    // Le gardien a compté 6 sacs d'aliment le 15, et 10 de copeaux
    await db.superuser.journalEvent.createMany({
      data: [
        { id: uuid(201), tenantId: TENANT, siteId: NORD, campaignId: BANDE, authorId: OUSMANE, businessDate: new Date('2026-11-15'), recordedAt: new Date('2026-11-15T09:00:00.000Z'), deviceId: uuid(93), type: 'Delivery', fact: { orderLineId: LIGNE_ALIMENT, receivedQuantity: 6, deliveryNote: { kind: 'NoPaper' } } },
        { id: uuid(202), tenantId: TENANT, siteId: NORD, campaignId: BANDE, authorId: OUSMANE, businessDate: new Date('2026-11-15'), recordedAt: new Date('2026-11-15T09:01:00.000Z'), deviceId: uuid(93), type: 'Delivery', fact: { orderLineId: LIGNE_COPEAUX, receivedQuantity: 10, deliveryNote: { kind: 'NoPaper' } } },
      ],
    });

    expect(await lis()).toEqual({
      today: '2026-11-20',
      receptions: [
        {
          receptionId: uuid(101), orderId: COMMANDE, supplierId: SEDIMA, campaignId: BANDE, plannedOn: '2026-11-15', previousDates: [], state: 'Late',
          lines: [
            { orderLineId: LIGNE_ALIMENT, costTypeId: ALIMENT, expected: 10, received: 6, remaining: 4 },
            { orderLineId: LIGNE_COPEAUX, costTypeId: COPEAUX, expected: 10, received: 10, remaining: 0 },
          ],
        },
        { receptionId: uuid(102), orderId: COMMANDE, supplierId: SEDIMA, campaignId: BANDE, plannedOn: '2026-11-25', previousDates: [], state: 'Coming', lines: [{ orderLineId: LIGNE_ALIMENT, costTypeId: ALIMENT, expected: 10, received: 0, remaining: 10 }] },
      ],
    });
    expect(await db.superuser.auditEvent.count({ where: { action: 'ReceptionPlanned', actorId: LE_GERANT } })).toBe(2);
  });

  it('une réception en retard se reprogramme : la nouvelle date fait foi, l’ancienne reste lisible', async () => {
    expect((await prevois(uuid(101), '2026-11-22', [{ orderLineId: LIGNE_ALIMENT, quantity: 10 }, { orderLineId: LIGNE_COPEAUX, quantity: 10 }])).status).toBe(204);
    const premiere = (await lis()).receptions.find(({ receptionId }) => receptionId === uuid(101));
    expect(premiere).toMatchObject({ plannedOn: '2026-11-22', previousDates: ['2026-11-15'], state: 'Coming' });

    // Ramenée au 15 : le 15 est sa date, il n'est plus « avant »
    expect((await prevois(uuid(101), '2026-11-15', [{ orderLineId: LIGNE_ALIMENT, quantity: 10 }, { orderLineId: LIGNE_COPEAUX, quantity: 10 }])).status).toBe(204);
    expect((await lis()).receptions.find(({ receptionId }) => receptionId === uuid(101))).toMatchObject({ plannedOn: '2026-11-15', previousDates: ['2026-11-22'] });
  });

  it('retirer une réception prévue : elle sort de la liste, rien n’est effacé', async () => {
    expect((await call('POST', `orders/${COMMANDE}/receptions/${uuid(102)}/withdraw`, { id: crypto.randomUUID() })).status).toBe(204);
    expect((await lis()).receptions.map(({ receptionId }) => receptionId)).toEqual([uuid(101)]);
    // 2 réceptions, 2 reprogrammations, 1 retrait : 5 lignes, aucune effacée
    expect(await db.superuser.plannedReception.count()).toBe(5);
    expect(await db.superuser.auditEvent.count({ where: { action: 'ReceptionWithdrawn' } })).toBe(1);
  });

  it('les règles du domaine refusent (400) ; une commande inconnue n’existe pas (404) ; une demande mal formée non plus (400)', async () => {
    expect(await refus(await prevois(uuid(103), '2026-11-09', [{ orderLineId: LIGNE_ALIMENT, quantity: 5 }]))).toEqual({ status: 400, kind: 'BeforeOrderDay' });
    expect(await refus(await prevois(uuid(103), '2026-11-28', [{ orderLineId: uuid(99), quantity: 5 }]))).toEqual({ status: 400, kind: 'UnknownOrderLine' });
    expect((await prevois(uuid(103), '2026-11-28', [{ orderLineId: LIGNE_ALIMENT, quantity: 5 }], uuid(98))).status).toBe(404);
    expect(await refus(await call('PUT', `orders/${COMMANDE}/receptions/${uuid(103)}`, { id: crypto.randomUUID(), plannedOn: '2026-11-28' }))).toEqual({ status: 400, kind: 'InvalidRequest' });
  });

  it('une commande close n’attend plus rien : on n’y prévoit plus (409), et ses réceptions prévues sortent de la liste', async () => {
    await db.superuser.purchaseOrder.update({ where: { id: COMMANDE }, data: { closedAt: new Date('2026-11-20T08:00:00.000Z') } });
    expect(await refus(await prevois(uuid(104), '2026-11-28', [{ orderLineId: LIGNE_ALIMENT, quantity: 5 }]))).toEqual({ status: 409, kind: 'OrderNotReceiving' });
    expect((await lis()).receptions).toEqual([]);
  });

  it('le gardien ne lit pas les réceptions prévues du bureau (403) : sa carte de livraison lui suffit', async () => {
    expect((await call('GET', 'receptions', undefined, tokenOf(OUSMANE, 'collaborator'))).status).toBe(403);
  });
});
