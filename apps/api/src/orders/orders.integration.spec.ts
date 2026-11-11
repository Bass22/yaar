import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { unwrap, type Clock } from '@kit';
import { Instant } from '@domain/journal';
import type { DraftOrderRequest, OrderView } from '@contracts';
import { AppModule } from '../app.module';
import { issueAccessToken, type SessionClaims } from '../auth/access-token';
import { CLOCK } from '../auth/auth.module';
import { APP_CONFIG } from '../config/app-config';
import { configureApp } from '../create-app';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';

// Spec: backlog Q.4 — l'API des commandes ; cahier des charges « Commandes » (le cycle, l'argent,
// au bureau : décisions du 2026-11-09) ; CLAUDE.md §4 règles 3, 4, 5, 6 et 14. PostgreSQL réel, HTTP.
jest.setTimeout(180_000);

const SECRET = 'un-secret-de-test-assez-long-pour-signer-des-jetons';
const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT_A = uuid(10);
const TENANT_B = uuid(11);
const NORD = uuid(3);
const SITE_DE_B = uuid(33);
const BANDE = uuid(4);
const ANCIENNE_BANDE = uuid(5);
const BANDE_DE_B = uuid(6);
const SEDIMA = uuid(31);
const RAMASSEUR = uuid(32);
const ALIMENT = uuid(41);
const POUSSINS = uuid(42);
const GARDIENNAGE = uuid(43);
const OUSMANE = uuid(51);
const LE_GERANT = uuid(54);
const GERANT_DE_B = uuid(55);
const ORDINATEUR = uuid(92);
const PIN_HASH = '$argon2id$v=19$m=19456,t=2,p=1$dGVzdC1vbmx5LXNhbHQ$dGVzdC1vbmx5LWRpZ2VzdC1ub3QtYS1yZWFsLXBpbg';

describe('Les commandes, au bureau', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let origin: string;
  const now = Date.parse('2026-10-12T09:00:00.000Z');
  // One second further at each reading: the traces of one order keep the order they were written in.
  let tick = 0;
  const clock: Clock = { now: () => new Date(now + (tick += 1000)) };

  const tokenOf = (sub: string, tenant: string, role: SessionClaims['role']) =>
    issueAccessToken({ sub, tenant, role, device: ORDINATEUR }, unwrap(Instant(new Date(now - 60_000).toISOString())), SECRET);
  const gerant = () => tokenOf(LE_GERANT, TENANT_A, 'admin');
  type Token = ReturnType<typeof gerant>;
  const call = (method: string, path: string, body?: unknown, token: Token = gerant()) =>
    fetch(`${origin}/api/v1/${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const prepare = (body: unknown, token?: Token) => call('POST', 'orders', body, token);
  const modifie = (id: string, body: unknown) => call('PUT', `orders/${id}`, body);
  const annonce = (id: string) => call('POST', `orders/${id}/announce`);
  const clos = (id: string) => call('POST', `orders/${id}/close`);
  const commandes = async (token?: Token) => (await (await call('GET', 'orders', undefined, token)).json()) as OrderView[];
  const laCommande = async (id: string) => (await commandes()).find((order) => order.id === id);
  const traceOf = (subjectId: string) =>
    db.superuser.auditEvent.findMany({ where: { subjectId }, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }], select: { action: true, actorId: true, deviceId: true, siteId: true } });
  const kindOf = async (response: Response) => ((await response.json()) as { kind?: string }).kind;

  // The order of 12/10: 20 bags of feed at 17 500 F and 1 000 chicks at 550 F.
  const uneCommande = (rank: number, fields: Partial<DraftOrderRequest> = {}): DraftOrderRequest => ({
    id: uuid(rank),
    supplierId: SEDIMA,
    campaignId: BANDE,
    orderDay: '2026-10-12',
    reference: 'BC-0412',
    lines: [
      { id: uuid(rank * 10 + 1), costTypeId: ALIMENT, quantity: 20, unitPrice: 17_500 },
      { id: uuid(rank * 10 + 2), costTypeId: POUSSINS, quantity: 1000, unitPrice: 550 },
    ],
    ...fields,
  });
  const recoit = (rank: number, orderLineId: string, receivedQuantity: number) =>
    db.superuser.journalEvent.create({
      data: {
        id: uuid(rank),
        tenantId: TENANT_A,
        siteId: NORD,
        campaignId: BANDE,
        authorId: OUSMANE,
        businessDate: new Date('2026-10-14'),
        recordedAt: new Date('2026-10-14T08:00:00.000Z'),
        deviceId: uuid(93),
        type: 'Delivery',
        fact: { orderLineId, receivedQuantity, deliveryNote: { kind: 'NoPaper' } },
      },
    });

  beforeAll(async () => {
    db = await createTestDatabase();
    await db.superuser.tenant.createMany({ data: [TENANT_A, TENANT_B].map((id) => ({ id, name: 'Ferme', currency: 'XOF' })) });
    await db.superuser.site.createMany({
      data: [
        { id: NORD, tenantId: TENANT_A, name: 'Poulailler Nord', timeZone: 'Africa/Dakar' },
        { id: SITE_DE_B, tenantId: TENANT_B, name: 'Chez B', timeZone: 'Africa/Dakar' },
      ],
    });
    await db.superuser.campaign.createMany({
      data: [
        { id: BANDE, tenantId: TENANT_A, siteId: NORD, placementDay: new Date('2026-10-01'), strain: 'Cobb500', plannedHeadcount: 1000, plannedDuration: 45 },
        { id: ANCIENNE_BANDE, tenantId: TENANT_A, siteId: NORD, placementDay: new Date('2026-07-01'), strain: 'Cobb500', plannedHeadcount: 1000, plannedDuration: 45, closedAt: new Date('2026-08-20T10:00:00.000Z') },
        { id: BANDE_DE_B, tenantId: TENANT_B, siteId: SITE_DE_B, placementDay: new Date('2026-10-01'), strain: 'Cobb500', plannedHeadcount: 1000, plannedDuration: 45 },
      ],
    });
    await db.superuser.user.createMany({
      data: [
        { id: OUSMANE, tenantId: TENANT_A, role: 'collaborator', phone: '+221770000001', name: 'Ousmane', pinHash: PIN_HASH },
        { id: LE_GERANT, tenantId: TENANT_A, role: 'admin', phone: '+221770000002', name: 'Le gérant', pinHash: PIN_HASH },
        { id: GERANT_DE_B, tenantId: TENANT_B, role: 'admin', phone: '+221770000003', name: 'Gérant B', pinHash: PIN_HASH },
      ],
    });
    await db.superuser.counterparty.createMany({
      data: [
        { id: SEDIMA, tenantId: TENANT_A, kind: 'Supplier', name: 'Sedima', face: 'closed-bag' },
        { id: RAMASSEUR, tenantId: TENANT_A, kind: 'Customer', name: 'Ramasseur', face: 'hen' },
      ],
    });
    await db.superuser.costType.createMany({
      data: [
        { id: ALIMENT, tenantId: TENANT_A, category: 'Feed', name: 'Aliment démarrage', behaviour: 'Variable' },
        { id: POUSSINS, tenantId: TENANT_A, category: 'Chicks', name: 'Poussins Cobb', behaviour: 'Variable' },
        { id: GARDIENNAGE, tenantId: TENANT_A, category: 'Labour', name: 'Gardiennage', behaviour: 'Fixed' },
      ],
    });
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

  it("l'admin prépare une commande en brouillon : relue avec ses lignes, son état, rien de facturable ; la préparation est tracée", async () => {
    expect((await prepare(uneCommande(1))).status).toBe(201);

    expect(await laCommande(uuid(1))).toEqual({
      id: uuid(1),
      supplierId: SEDIMA,
      campaignId: BANDE,
      orderDay: '2026-10-12',
      reference: 'BC-0412',
      currency: 'XOF',
      status: 'Draft',
      lines: [
        { id: uuid(11), costTypeId: ALIMENT, quantity: 20, unitPrice: 17_500, received: 0 },
        { id: uuid(12), costTypeId: POUSSINS, quantity: 1000, unitPrice: 550, received: 0 },
      ],
      billable: 0,
      paid: 0,
      payments: [],
    });
    expect(await traceOf(uuid(1))).toEqual([{ action: 'OrderDrafted', actorId: LE_GERANT, deviceId: ORDINATEUR, siteId: NORD }]);
  });

  it('les règles du domaine refusent (400, avec le motif) sans rien écrire : un client pour fournisseur, un type non commandable, aucune ligne', async () => {
    const responses = [
      await prepare(uneCommande(2, { supplierId: RAMASSEUR })),
      await prepare(uneCommande(3, { lines: [{ id: uuid(31), costTypeId: GARDIENNAGE, quantity: 1, unitPrice: 50_000 }] })),
      await prepare(uneCommande(4, { lines: [] })),
    ];

    expect(responses.map((response) => response.status)).toEqual([400, 400, 400]);
    expect(await Promise.all(responses.map(kindOf))).toEqual(['NotASupplier', 'CostTypeNotOrderable', 'OrderWithoutLines']);
    expect(await db.superuser.purchaseOrder.count({ where: { id: { in: [uuid(2), uuid(3), uuid(4)] } } })).toBe(0);
  });

  it("une bande close, inconnue ou d'un autre élevage ne reçoit pas de commande (400) ; un champ en trop non plus", async () => {
    const responses = [
      await prepare(uneCommande(5, { campaignId: ANCIENNE_BANDE })),
      await prepare(uneCommande(6, { campaignId: BANDE_DE_B })),
      await prepare(uneCommande(7, { campaignId: uuid(99) })),
      await prepare({ ...uneCommande(8), tenantId: TENANT_B }),
      await prepare({ ...uneCommande(9), announcedAt: '2026-10-12T09:00:00.000Z' }),
    ];

    expect(responses.map((response) => response.status)).toEqual([400, 400, 400, 400, 400]);
    expect(await Promise.all(responses.slice(0, 3).map(kindOf))).toEqual(['CampaignClosed', 'UnknownCampaign', 'UnknownCampaign']);
    expect(await db.superuser.purchaseOrder.count({ where: { id: { in: [5, 6, 7, 8, 9].map(uuid) } } })).toBe(0);
  });

  it('un identifiant déjà pris est refusé (409), la commande existante n’est pas touchée', async () => {
    expect((await prepare(uneCommande(1, { reference: 'Écrasée' }))).status).toBe(409);
    expect((await laCommande(uuid(1)))?.reference).toBe('BC-0412');
  });

  it("l'admin modifie un brouillon : il est réécrit entier, lignes comprises ; la modification est tracée", async () => {
    const revised = uneCommande(1, { reference: null, lines: [{ id: uuid(13), costTypeId: ALIMENT, quantity: 30, unitPrice: 17_000 }] });

    expect((await modifie(uuid(1), revised)).status).toBe(204);
    expect(await laCommande(uuid(1))).toMatchObject({ reference: null, lines: [{ id: uuid(13), costTypeId: ALIMENT, quantity: 30, unitPrice: 17_000, received: 0 }] });
    expect((await traceOf(uuid(1))).map(({ action }) => action)).toEqual(['OrderDrafted', 'OrderRevised']);
  });

  it("l'admin annonce un brouillon : il est annoncé, tracé ; l'annoncer encore ou le modifier ensuite est refusé (409)", async () => {
    await prepare(uneCommande(20));

    expect((await annonce(uuid(20))).status).toBe(204);
    expect((await laCommande(uuid(20)))?.status).toBe('Announced');
    const [again, revised] = [await annonce(uuid(20)), await modifie(uuid(20), uneCommande(20, { reference: 'BC-9' }))];
    expect([again.status, await kindOf(again), revised.status, await kindOf(revised)]).toEqual([409, 'OrderAlreadyAnnounced', 409, 'OrderAnnounced']);
    expect((await traceOf(uuid(20))).map(({ action }) => action)).toEqual(['OrderDrafted', 'OrderAnnounced']);
  });

  it('le reçu de chaque ligne vient du journal de la bande, et la commande dit son état : partiellement reçue, puis le facturable en francs', async () => {
    // 8 sacs reçus sur 20 : facturable 8 × 17 500 = 140 000 F
    await recoit(201, uuid(201), 8);

    expect(await laCommande(uuid(20))).toMatchObject({
      status: 'PartiallyReceived',
      lines: [
        { id: uuid(201), received: 8 },
        { id: uuid(202), received: 0 },
      ],
      billable: 140_000,
    });
  });

  it("l'admin clôt une commande incomplète : close, tracée ; la clore encore est refusé (409)", async () => {
    expect((await clos(uuid(20))).status).toBe(204);

    expect((await laCommande(uuid(20)))?.status).toBe('Closed');
    const again = await clos(uuid(20));
    expect([again.status, await kindOf(again)]).toEqual([409, 'OrderClosed']);
    expect((await traceOf(uuid(20))).map(({ action }) => action)).toEqual(['OrderDrafted', 'OrderAnnounced', 'OrderClosed']);
  });

  it('clore un brouillon, ou une commande entièrement reçue, est refusé (409)', async () => {
    await prepare(uneCommande(30));
    await prepare(uneCommande(40));
    await annonce(uuid(40));
    await recoit(401, uuid(401), 20);
    await recoit(402, uuid(402), 1050);

    const [draft, received] = [await clos(uuid(30)), await clos(uuid(40))];
    expect([draft.status, await kindOf(draft), received.status, await kindOf(received)]).toEqual([409, 'OrderNotAnnounced', 409, 'OrderFullyReceived']);
    // Bonus compris, la commande est reçue ; le facturable ne compte que 1 000 poussins : 350 000 + 550 000 = 900 000 F
    expect(await laCommande(uuid(40))).toMatchObject({ status: 'Received', billable: 900_000 });
  });

  it("la commande d'un autre élevage n'existe pas (404) et ne se voit pas", async () => {
    await db.superuser.counterparty.create({ data: { id: uuid(97), tenantId: TENANT_B, kind: 'Supplier', name: 'Fournisseur de B', face: 'truck' } });
    await db.superuser.costType.create({ data: { id: uuid(96), tenantId: TENANT_B, category: 'Feed', name: 'Aliment de B', behaviour: 'Variable' } });
    const deB = await prepare(
      uneCommande(60, { campaignId: BANDE_DE_B, supplierId: uuid(97), lines: [{ id: uuid(601), costTypeId: uuid(96), quantity: 5, unitPrice: 17_000 }] }),
      tokenOf(GERANT_DE_B, TENANT_B, 'admin'),
    );
    expect(deB.status).toBe(201);

    expect([(await modifie(uuid(60), uneCommande(60))).status, (await annonce(uuid(60))).status, (await clos(uuid(60))).status]).toEqual([404, 404, 404]);
    expect((await commandes()).map(({ id }) => id)).not.toContain(uuid(60));
  });

  it('un gardien reçoit un refus sur toute route de commandes (403) : ni prix, ni commande, ne lui parviennent', async () => {
    const caretaker = tokenOf(OUSMANE, TENANT_A, 'collaborator');

    const statuses = await Promise.all([
      call('GET', 'orders', undefined, caretaker),
      prepare(uneCommande(70), caretaker),
      call('PUT', `orders/${uuid(1)}`, uneCommande(1), caretaker),
      call('POST', `orders/${uuid(1)}/announce`, undefined, caretaker),
      call('POST', `orders/${uuid(1)}/close`, undefined, caretaker),
    ]);
    expect(statuses.map((response) => response.status)).toEqual([403, 403, 403, 403, 403]);
  });
});
