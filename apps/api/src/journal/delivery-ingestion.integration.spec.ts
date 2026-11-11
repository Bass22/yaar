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

// Spec: backlog Q.7 — le gardien compte la livraison ; cahier des charges « Livraison annoncée »
// (décisions du 2026-11-11 : à l'ingestion, une réception vise une ligne d'une commande annoncée,
// pas close, de sa bande ; les vivants sont connus dès que des poussins sont reçus) ; « Commandes »
// (Q.1). PostgreSQL réel, HTTP, avec le gardien du site.
jest.setTimeout(180_000);

const SECRET = 'un-secret-de-test-assez-long-pour-signer-des-jetons';
const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT = uuid(10);
const NORD = uuid(3);
const BANDE = uuid(4);
const AUTRE_BANDE = uuid(5);
const SEDIMA = uuid(31);
const ALIMENT = uuid(41);
const POUSSINS = uuid(42);
const OUSMANE = uuid(51);
const TELEPHONE = uuid(93);
const PIN_HASH = '$argon2id$v=19$m=19456,t=2,p=1$dGVzdC1vbmx5LXNhbHQ$dGVzdC1vbmx5LWRpZ2VzdC1ub3QtYS1yZWFsLXBpbg';

describe('Une réception comptée par le gardien', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let origin: string;
  // Friday October 16th, 2026, 10:00 in Dakar.
  const now = Date.parse('2026-10-16T10:00:00.000Z');
  const clock: Clock = { now: () => new Date(now) };
  const token = issueAccessToken({ sub: OUSMANE, tenant: TENANT, role: 'collaborator' as SessionClaims['role'], device: TELEPHONE }, unwrap(Instant(new Date(now - 60_000).toISOString())), SECRET);

  const send = async (events: unknown[]) => {
    const response = await fetch(`${origin}/api/v1/journal/events`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ events }) });
    return ((await response.json()) as { outcomes: { status: string; refusal?: { kind: string } }[] }).outcomes.map((outcome) => outcome.status === 'Refused' ? outcome.refusal?.kind : outcome.status);
  };
  const envoi = (rank: number, fact: Record<string, unknown>, extra: Record<string, unknown> = {}, campaignId = BANDE) => ({
    id: uuid(rank),
    siteId: NORD,
    campaignId,
    businessDate: '2026-10-16',
    recordedAt: new Date(now - 3_600_000 + rank * 1000).toISOString(),
    fact,
    ...extra,
  });
  const recu = (orderLineId: string, receivedQuantity: number) => ({ type: 'Delivery', orderLineId, receivedQuantity, deliveryNote: { kind: 'NoPaper' } });
  const contexte = async () => (await (await fetch(`${origin}/api/v1/caretaker/context`, { headers: { Authorization: `Bearer ${token}` } })).json()) as CaretakerContext;
  const bande = async (campaignId = BANDE) => (await contexte()).sites[0]?.campaigns.find((campaign) => campaign.campaignId === campaignId);
  // An order of 12/10 for a campaign: 20 bags of feed (line rank*10+1) and 1 000 chicks (rank*10+2).
  const commande = async (rank: number, state: { announcedAt?: Date; closedAt?: Date }, campaignId = BANDE) => {
    await db.superuser.purchaseOrder.create({ data: { id: uuid(rank), tenantId: TENANT, supplierId: SEDIMA, campaignId, orderDay: new Date('2026-10-12'), currency: 'XOF', ...state } });
    await db.superuser.orderLine.createMany({
      data: [
        { id: uuid(rank * 10 + 1), tenantId: TENANT, orderId: uuid(rank), position: 0, costTypeId: ALIMENT, quantity: 20, unitPrice: 17_500 },
        { id: uuid(rank * 10 + 2), tenantId: TENANT, orderId: uuid(rank), position: 1, costTypeId: POUSSINS, quantity: 1000, unitPrice: 550 },
      ],
    });
  };
  const announced = { announcedAt: new Date('2026-10-12T09:00:00.000Z') };

  beforeAll(async () => {
    db = await createTestDatabase();
    await db.superuser.tenant.create({ data: { id: TENANT, name: 'Ferme', currency: 'XOF' } });
    await db.superuser.site.create({ data: { id: NORD, tenantId: TENANT, name: 'Poulailler Nord', timeZone: 'Africa/Dakar' } });
    await db.superuser.campaign.createMany({
      data: [
        { id: BANDE, tenantId: TENANT, siteId: NORD, placementDay: new Date('2026-10-14'), strain: 'Cobb500', plannedHeadcount: 1000, plannedDuration: 45 },
        { id: AUTRE_BANDE, tenantId: TENANT, siteId: NORD, placementDay: new Date('2026-10-01'), strain: 'Cobb500', plannedHeadcount: 1000, plannedDuration: 45 },
      ],
    });
    await db.superuser.user.create({ data: { id: OUSMANE, tenantId: TENANT, role: 'collaborator', phone: '+221770000001', name: 'Ousmane', pinHash: PIN_HASH } });
    await db.superuser.siteAssignment.create({ data: { tenantId: TENANT, siteId: NORD, userId: OUSMANE, isPrimary: true } });
    await db.superuser.counterparty.create({ data: { id: SEDIMA, tenantId: TENANT, kind: 'Supplier', name: 'Sedima', face: 'closed-bag' } });
    await db.superuser.costType.createMany({
      data: [
        { id: ALIMENT, tenantId: TENANT, category: 'Feed', name: 'Aliment démarrage', behaviour: 'Variable' },
        { id: POUSSINS, tenantId: TENANT, category: 'Chicks', name: 'Poussins Cobb', behaviour: 'Variable' },
      ],
    });
    // 1: announced. 2: a draft. 3: announced then closed. 4: announced, for the other flock.
    await commande(1, announced);
    await commande(2, {});
    await commande(3, { ...announced, closedAt: new Date('2026-10-15T09:00:00.000Z') });
    await commande(4, announced, AUTRE_BANDE);

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

  it('avant que des poussins soient reçus, les vivants ne sont pas connus : jamais zéro', async () => {
    expect((await bande())?.liveCount).toBeNull();
  });

  it('le gardien reçoit sur une ligne d’une commande annoncée de sa bande : accepté, le reste à venir baisse', async () => {
    expect(await send([envoi(101, recu(uuid(11), 8))])).toEqual(['Accepted']);
    expect((await bande())?.deliveries[0]?.lines[0]).toMatchObject({ received: 8, remaining: 12 });
  });

  it('une ligne de brouillon ou de commande close ne reçoit pas ; une ligne inconnue, ou d’une autre bande, non plus — rien ne s’écrit', async () => {
    expect(await send([envoi(111, recu(uuid(21), 20)), envoi(112, recu(uuid(31), 20)), envoi(113, recu(uuid(99), 20)), envoi(114, recu(uuid(41), 20))])).toEqual([
      'OrderNotReceiving',
      'OrderNotReceiving',
      'UnknownOrderLine',
      'UnknownOrderLine',
    ]);
    expect(await db.superuser.journalEvent.count({ where: { id: { in: [111, 112, 113, 114].map(uuid) } } })).toBe(0);
  });

  it('21 cartons de poussins comptés (1 050, un carton de bonus) : les vivants sont connus, morts déduits', async () => {
    // 1 050 received − 3 deaths = 1 047 alive.
    expect(await send([envoi(121, recu(uuid(12), 1050)), envoi(122, { type: 'Death', quantity: 3 })])).toEqual(['Accepted', 'Accepted']);

    expect((await bande())?.liveCount).toBe(1047);
    // The journal line says what was received, by name and category — never a price.
    expect((await bande())?.journal.find((line) => line.id === uuid(121))?.delivery).toEqual({ name: 'Poussins Cobb', category: 'Chicks' });
    // The feed received is not counted among the living.
    expect((await bande())?.deliveries[0]?.lines.map(({ received }) => received)).toEqual([8, 1050]);
  });

  it('les poussins d’une autre bande ne comptent pas dans les vivants de celle-ci', async () => {
    expect(await send([envoi(131, recu(uuid(42), 500), {}, AUTRE_BANDE)])).toEqual(['Accepted']);

    expect([(await bande())?.liveCount, (await bande(AUTRE_BANDE))?.liveCount]).toEqual([1047, 500]);
  });

  it('une réception se corrige même une fois la commande close : on corrige un compte, pas une commande', async () => {
    await db.superuser.purchaseOrder.update({ where: { id: uuid(1) }, data: { closedAt: new Date('2026-10-16T09:00:00.000Z') } });

    expect(await send([envoi(141, recu(uuid(11), 10), { corrects: uuid(101) })])).toEqual(['Accepted']);
  });
});
