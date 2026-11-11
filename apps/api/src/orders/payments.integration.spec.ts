import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { unwrap, type Clock } from '@kit';
import { Instant } from '@domain/journal';
import type { DraftOrderRequest, OrderView, RecordPaymentRequest } from '@contracts';
import { AppModule } from '../app.module';
import { issueAccessToken, type SessionClaims } from '../auth/access-token';
import { CLOCK } from '../auth/auth.module';
import { APP_CONFIG } from '../config/app-config';
import { configureApp } from '../create-app';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';

// Spec: backlog Q.9 — payer une commande ; cahier des charges « Commandes » (paiements découplés et
// multiples, « Payer une commande » : décision du 2026-11-11) ; CLAUDE.md §4 règles 2, 5, 8 et 14.
// PostgreSQL réel, HTTP.
jest.setTimeout(180_000);

const SECRET = 'un-secret-de-test-assez-long-pour-signer-des-jetons';
const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT_A = uuid(10);
const TENANT_B = uuid(11);
const NORD = uuid(3);
const SITE_DE_B = uuid(33);
const BANDE = uuid(4);
const BANDE_DE_B = uuid(6);
const SEDIMA = uuid(31);
const FOURNISSEUR_DE_B = uuid(34);
const ALIMENT = uuid(41);
const POUSSINS = uuid(42);
const ALIMENT_DE_B = uuid(44);
const OUSMANE = uuid(51);
const LE_GERANT = uuid(54);
const GERANT_DE_B = uuid(55);
const ORDINATEUR = uuid(92);
const PIN_HASH = '$argon2id$v=19$m=19456,t=2,p=1$dGVzdC1vbmx5LXNhbHQ$dGVzdC1vbmx5LWRpZ2VzdC1ub3QtYS1yZWFsLXBpbg';

describe('Payer une commande, au bureau', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let origin: string;
  const now = Date.parse('2026-10-16T09:00:00.000Z');
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
  const paie = (orderId: string, body: unknown, token?: Token) => call('POST', `orders/${orderId}/payments`, body, token);
  const unPaiement = (rank: number, fields: Partial<RecordPaymentRequest> = {}): RecordPaymentRequest => ({ id: uuid(rank), paidOn: '2026-10-13', amount: 400_000, method: 'Wave', ...fields });
  const laCommande = async (id: string, token: Token = gerant()) => ((await (await call('GET', 'orders', undefined, token)).json()) as OrderView[]).find((order) => order.id === id);
  const traceOf = (subjectId: string) => db.superuser.auditEvent.findMany({ where: { subjectId }, select: { action: true, actorId: true, deviceId: true, siteId: true } });
  const kindOf = async (response: Response) => ((await response.json()) as { kind?: string }).kind;

  // The order of 12/10: 20 bags of feed at 17 500 F and 1 000 chicks at 550 F = 900 000 F ordered.
  const commande = async (rank: number, state: { announcedAt?: Date; closedAt?: Date } = {}) => {
    const order: DraftOrderRequest = {
      id: uuid(rank),
      supplierId: SEDIMA,
      campaignId: BANDE,
      orderDay: '2026-10-12',
      reference: null,
      lines: [
        { id: uuid(rank * 10 + 1), costTypeId: ALIMENT, quantity: 20, unitPrice: 17_500 },
        { id: uuid(rank * 10 + 2), costTypeId: POUSSINS, quantity: 1000, unitPrice: 550 },
      ],
    };
    await db.superuser.purchaseOrder.create({ data: { id: order.id, tenantId: TENANT_A, supplierId: SEDIMA, campaignId: BANDE, orderDay: new Date(order.orderDay), currency: 'XOF', ...state } });
    await db.superuser.orderLine.createMany({ data: order.lines.map((line, position) => ({ ...line, tenantId: TENANT_A, orderId: order.id, position })) });
  };
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
        { id: FOURNISSEUR_DE_B, tenantId: TENANT_B, kind: 'Supplier', name: 'Fournisseur de B', face: 'truck' },
      ],
    });
    await db.superuser.costType.createMany({
      data: [
        { id: ALIMENT, tenantId: TENANT_A, category: 'Feed', name: 'Aliment démarrage', behaviour: 'Variable' },
        { id: POUSSINS, tenantId: TENANT_A, category: 'Chicks', name: 'Poussins Cobb', behaviour: 'Variable' },
        { id: ALIMENT_DE_B, tenantId: TENANT_B, category: 'Feed', name: 'Aliment de B', behaviour: 'Variable' },
      ],
    });
    // 1: announced, then fully received (900 000 F billable). 2: a draft. 3: announced, 8 bags received, then closed.
    await commande(1, { announcedAt: new Date('2026-10-12T09:00:00.000Z') });
    await recoit(101, uuid(11), 20);
    await recoit(102, uuid(12), 1000);
    await commande(2);
    await commande(3, { announcedAt: new Date('2026-10-12T09:00:00.000Z'), closedAt: new Date('2026-10-15T09:00:00.000Z') });
    await recoit(301, uuid(31), 8);
    // An order of farm B.
    await db.superuser.purchaseOrder.create({ data: { id: uuid(9), tenantId: TENANT_B, supplierId: FOURNISSEUR_DE_B, campaignId: BANDE_DE_B, orderDay: new Date('2026-10-12'), currency: 'XOF' } });

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

  it("deux paiements à d'autres dates, en Wave puis en Orange Money, se cumulent : la commande reçue passe à « soldée » ; le facturable ne bouge pas", async () => {
    // Billable: 20 × 17 500 + 1 000 × 550 = 350 000 + 550 000 = 900 000 F.
    expect(await laCommande(uuid(1))).toMatchObject({ status: 'Received', billable: 900_000, paid: 0 });

    expect((await paie(uuid(1), unPaiement(501))).status).toBe(201);
    expect(await laCommande(uuid(1))).toMatchObject({ status: 'Received', billable: 900_000, paid: 400_000 });

    // 400 000 + 500 000 = 900 000 F: paid in full.
    expect((await paie(uuid(1), unPaiement(502, { paidOn: '2026-10-16', amount: 500_000, method: 'OrangeMoney' }))).status).toBe(201);
    expect(await laCommande(uuid(1))).toMatchObject({
      status: 'Settled',
      billable: 900_000,
      paid: 900_000,
      payments: [
        { id: uuid(501), paidOn: '2026-10-13', amount: 400_000, method: 'Wave' },
        { id: uuid(502), paidOn: '2026-10-16', amount: 500_000, method: 'OrangeMoney' },
      ],
    });
  });

  it('un paiement avant toute réception est accepté (un acompte sur un brouillon) ; payer le reçu d’une commande close aussi', async () => {
    expect((await paie(uuid(2), unPaiement(511, { amount: 100_000, method: 'Cash' }))).status).toBe(201);
    expect(await laCommande(uuid(2))).toMatchObject({ status: 'Draft', billable: 0, paid: 100_000 });

    // Closed with 8 bags received: 8 × 17 500 = 140 000 F billable.
    expect((await paie(uuid(3), unPaiement(512, { amount: 140_000 }))).status).toBe(201);
    expect(await laCommande(uuid(3))).toMatchObject({ status: 'Settled', billable: 140_000, paid: 140_000 });
  });

  it('le même paiement renvoyé ne compte qu’une fois ; le même identifiant avec un autre montant est refusé (409)', async () => {
    expect((await paie(uuid(2), unPaiement(521, { amount: 50_000 }))).status).toBe(201);
    expect((await paie(uuid(2), unPaiement(521, { amount: 50_000 }))).status).toBe(200);
    const autre = await paie(uuid(2), unPaiement(521, { amount: 60_000 }));

    expect([autre.status, await kindOf(autre)]).toEqual([409, 'PaymentAlreadyExists']);
    // 100 000 + 50 000, once.
    expect((await laCommande(uuid(2)))?.paid).toBe(150_000);
    expect(await traceOf(uuid(521))).toHaveLength(1);
  });

  it("chaque commande ne liste que ses paiements, jamais ceux d'une autre", async () => {
    expect((await laCommande(uuid(2)))?.payments.map(({ id }) => id)).toEqual([uuid(511), uuid(521)]);
    expect((await laCommande(uuid(3)))?.payments.map(({ id }) => id)).toEqual([uuid(512)]);
  });

  it('chaque paiement est tracé : qui, depuis quel appareil, pour quel site', async () => {
    expect(await traceOf(uuid(501))).toEqual([{ action: 'PaymentRecorded', actorId: LE_GERANT, deviceId: ORDINATEUR, siteId: NORD }]);
  });

  it('les règles du domaine refusent (400, avec le motif) sans rien écrire : montant nul ou fractionnaire, moyen inconnu, date invalide ; un champ en trop aussi', async () => {
    const refus = await Promise.all([
      paie(uuid(1), unPaiement(531, { amount: 0 })),
      paie(uuid(1), unPaiement(532, { amount: 99.5 })),
      paie(uuid(1), unPaiement(533, { method: 'Cheque' as never })),
      paie(uuid(1), unPaiement(534, { paidOn: 'hier' })),
      paie(uuid(1), { ...unPaiement(535), orderId: uuid(2) }),
      paie(uuid(1), { ...unPaiement(536), amount: '400000' }),
    ]);

    expect(await Promise.all(refus.map(async (response) => [response.status, await kindOf(response)]))).toEqual([
      [400, 'InvalidAmount'],
      [400, 'InvalidAmount'],
      [400, 'UnknownPaymentMethod'],
      [400, 'InvalidBusinessDay'],
      [400, 'InvalidRequest'],
      [400, 'InvalidRequest'],
    ]);
    expect(await db.superuser.payment.count({ where: { id: { in: [531, 532, 533, 534, 535, 536].map(uuid) } } })).toBe(0);
  });

  it("la commande d'un autre élevage, ou inconnue, n'existe pas (404) ; ses paiements ne se voient pas", async () => {
    expect((await paie(uuid(9), unPaiement(541))).status).toBe(404);
    expect((await paie(uuid(99), unPaiement(542))).status).toBe(404);
    expect((await paie('pas-un-uuid', unPaiement(543))).status).toBe(404);
    await db.superuser.payment.create({ data: { id: uuid(549), tenantId: TENANT_B, orderId: uuid(9), paidOn: new Date('2026-10-13'), amount: 1000, method: 'Cash', recordedBy: GERANT_DE_B } });

    expect((await laCommande(uuid(9), tokenOf(GERANT_DE_B, TENANT_B, 'admin')))?.paid).toBe(1000);
    expect(await laCommande(uuid(9))).toBeUndefined();
  });

  it('un gardien reçoit un refus (403) : il ne paie rien et ne voit aucun paiement', async () => {
    const response = await paie(uuid(1), unPaiement(551), tokenOf(OUSMANE, TENANT_A, 'collaborator'));

    expect(response.status).toBe(403);
    expect(await db.superuser.payment.count({ where: { id: uuid(551) } })).toBe(0);
  });
});
