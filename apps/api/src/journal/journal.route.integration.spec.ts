import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { unwrap, type Clock } from '@kit';
import { Instant, TenantId, UserId } from '@domain/journal';
import { AppModule } from '../app.module';
import { issueAccessToken, type SessionClaims } from '../auth/access-token';
import { CLOCK } from '../auth/auth.module';
import { APP_CONFIG } from '../config/app-config';
import { configureApp } from '../create-app';
import { PrismaService } from '../database/prisma.service';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';
import { decodeJournalEvent } from './decode-event';
import { MAX_EVENTS_PER_BATCH } from './journal.controller';
import { PrismaJournal } from './prisma-journal';

// Spec: Architecture §4 (`journal`), §5 (le téléphone envoie son journal par lots, idempotent
// par UUID) ; CLAUDE.md §4 règles 1, 2, 5 et 14 ; backlog F.2. PostgreSQL réel, serveur HTTP.
jest.setTimeout(180_000);

const SECRET = 'un-secret-de-test-assez-long-pour-signer-des-jetons';
const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT_A = uuid(10);
const TENANT_B = uuid(11);
const NORD = uuid(3);
const SITE_DE_B = uuid(33);
const BANDE_NORD = uuid(4);
const BANDE_DE_B = uuid(44);
const OUSMANE = uuid(51);
const MODOU = uuid(53);
const LE_GERANT = uuid(54);
const GARDIEN_DE_B = uuid(61);
const TELEPHONE = uuid(91);
const PIN_HASH = '$argon2id$v=19$m=19456,t=2,p=1$dGVzdC1vbmx5LXNhbHQ$dGVzdC1vbmx5LWRpZ2VzdC1ub3QtYS1yZWFsLXBpbg';
const MEDIA = 'c'.repeat(64);

const envoi = (rank: number, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: uuid(rank),
  siteId: NORD,
  campaignId: BANDE_NORD,
  businessDate: '2026-11-05',
  recordedAt: '2026-11-05T18:30:00.000Z',
  fact: { type: 'Death', quantity: 3 },
  ...overrides,
});

describe("L'API reçoit le journal", () => {
  let db: TestDatabase;
  let app: INestApplication;
  let origin: string;
  const now = Date.parse('2026-11-06T08:00:00.000Z');
  const clock: Clock = { now: () => new Date(now) };

  const tokenOf = (sub: string, tenant: string, role: SessionClaims['role']) =>
    issueAccessToken({ sub, tenant, role, device: TELEPHONE }, unwrap(Instant(new Date(now).toISOString())), SECRET);
  const ousmane = () => tokenOf(OUSMANE, TENANT_A, 'collaborator');
  const send = (body: unknown, token = ousmane()) =>
    fetch(`${origin}/api/v1/journal/events`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const outcomesOf = async (response: Response) => {
    expect(response.status).toBe(200);
    return ((await response.json()) as { outcomes: unknown[] }).outcomes;
  };
  const rowsOf = (tenantId: string) => db.superuser.journalEvent.findMany({ where: { tenantId }, orderBy: { id: 'asc' } });

  beforeAll(async () => {
    db = await createTestDatabase();
    for (const [tenantId, siteId, campaignId] of [
      [TENANT_A, NORD, BANDE_NORD],
      [TENANT_B, SITE_DE_B, BANDE_DE_B],
    ] as const) {
      await db.superuser.tenant.create({ data: { id: tenantId, name: 'Ferme', currency: 'XOF' } });
      await db.superuser.site.create({ data: { id: siteId, tenantId, name: 'Poulailler', timeZone: 'Africa/Dakar' } });
      await db.superuser.campaign.create({ data: { id: campaignId, tenantId, siteId, placementDay: new Date('2026-10-15'), strain: 'Cobb500', plannedHeadcount: 1000, plannedDuration: 45 } });
    }
    const user = (id: string, tenantId: string, role: 'admin' | 'collaborator', rank: number) => ({ id, tenantId, role, phone: `+22177000${String(rank).padStart(4, '0')}`, name: 'Compte', pinHash: PIN_HASH });
    await db.superuser.user.createMany({ data: [user(OUSMANE, TENANT_A, 'collaborator', 1), user(MODOU, TENANT_A, 'collaborator', 2), user(LE_GERANT, TENANT_A, 'admin', 3), user(GARDIEN_DE_B, TENANT_B, 'collaborator', 4)] });
    await db.superuser.siteAssignment.createMany({
      data: [
        { tenantId: TENANT_A, siteId: NORD, userId: OUSMANE, isPrimary: true },
        { tenantId: TENANT_B, siteId: SITE_DE_B, userId: GARDIEN_DE_B, isPrimary: true },
      ],
    });
    // An announced order of the Nord flock, whose lines 7 and 8 receive the deliveries below (Q.7).
    await db.superuser.counterparty.create({ data: { id: uuid(71), tenantId: TENANT_A, kind: 'Supplier', name: 'Sedima', face: 'closed-bag' } });
    await db.superuser.costType.create({ data: { id: uuid(72), tenantId: TENANT_A, category: 'Feed', name: 'Aliment', behaviour: 'Variable' } });
    await db.superuser.purchaseOrder.create({ data: { id: uuid(73), tenantId: TENANT_A, supplierId: uuid(71), campaignId: BANDE_NORD, orderDay: new Date('2026-10-30'), currency: 'XOF', announcedAt: new Date('2026-10-30T09:00:00.000Z') } });
    await db.superuser.orderLine.createMany({
      data: [7, 8].map((rank, position) => ({ id: uuid(rank), tenantId: TENANT_A, orderId: uuid(73), position, costTypeId: uuid(72), quantity: 40, unitPrice: 17_500 })),
    });
    // The weighing below answers this request of the Nord flock (T.2).
    await db.superuser.weighingRequest.create({ data: { id: uuid(9), tenantId: TENANT_A, campaignId: BANDE_NORD, requestedFor: new Date('2026-11-04'), requestedBy: LE_GERANT } });
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

  it("un lot est accepté et rejoint le journal de l'élevage de la session : auteur et appareil de la session, date de réception posée par la base", async () => {
    // When
    const outcomes = await outcomesOf(await send({ events: [envoi(1)] }));

    // Then
    expect(outcomes).toEqual([{ index: 0, id: uuid(1), status: 'Accepted' }]);
    const [row] = await rowsOf(TENANT_A);
    expect(row).toMatchObject({ id: uuid(1), tenantId: TENANT_A, authorId: OUSMANE, deviceId: TELEPHONE, type: 'Death', fact: { quantity: 3 } });
    expect(row?.receivedAt.getTime()).toBeGreaterThan(Date.parse('2026-11-05T18:30:00.000Z'));
  });

  it("le même lot envoyé deux fois ne crée aucune ligne en double : la seconde fois, chaque événement est un doublon", async () => {
    const batch = { events: [envoi(2), envoi(3, { fact: { type: 'BagOpened', quantity: 1 } })] };
    await send(batch);
    const before = (await rowsOf(TENANT_A)).length;

    const outcomes = await outcomesOf(await send(batch));

    expect(outcomes).toEqual([
      { index: 0, id: uuid(2), status: 'Duplicate' },
      { index: 1, id: uuid(3), status: 'Duplicate' },
    ]);
    expect(await rowsOf(TENANT_A)).toHaveLength(before);
  });

  it("un UUID déjà utilisé par un autre élevage ne révèle rien et n'écrase rien : chacun garde sa ligne", async () => {
    // Given un événement de l'élevage B
    await outcomesOf(await send({ events: [envoi(70, { siteId: SITE_DE_B, campaignId: BANDE_DE_B, fact: { type: 'Death', quantity: 9 } })] }, tokenOf(GARDIEN_DE_B, TENANT_B, 'collaborator')));

    // When Ousmane envoie le même identifiant chez A
    const outcomes = await outcomesOf(await send({ events: [envoi(70)] }));

    // Then c'est un nouvel événement de A, et celui de B est intact
    expect(outcomes).toEqual([{ index: 0, id: uuid(70), status: 'Accepted' }]);
    const both = await db.superuser.journalEvent.findMany({ where: { id: uuid(70) }, orderBy: { tenantId: 'asc' }, select: { tenantId: true, fact: true } });
    expect(both).toEqual([
      { tenantId: TENANT_A, fact: { quantity: 3 } },
      { tenantId: TENANT_B, fact: { quantity: 9 } },
    ]);
  });

  it("la bande d'un autre élevage n'existe pas pour la session : refusée, sans rien écrire chez personne", async () => {
    const before = { a: (await rowsOf(TENANT_A)).length, b: (await rowsOf(TENANT_B)).length };

    const outcomes = await outcomesOf(await send({ events: [envoi(71, { siteId: SITE_DE_B, campaignId: BANDE_DE_B })] }));

    expect(outcomes).toEqual([{ index: 0, id: uuid(71), status: 'Refused', refusal: { kind: 'UnknownCampaign' } }]);
    expect({ a: (await rowsOf(TENANT_A)).length, b: (await rowsOf(TENANT_B)).length }).toEqual(before);
  });

  it("un champ inconnu dans un événement le fait refuser, en le nommant ; un gardien non affecté au site est refusé", async () => {
    const outcomes = await outcomesOf(await send({ events: [envoi(72, { authorId: LE_GERANT })] }));
    const notAssigned = await outcomesOf(await send({ events: [envoi(73)] }, tokenOf(MODOU, TENANT_A, 'collaborator')));

    expect(outcomes).toEqual([{ index: 0, status: 'Refused', refusal: { kind: 'UnknownField', field: 'authorId' } }]);
    expect(notAssigned).toEqual([{ index: 0, id: uuid(73), status: 'Refused', refusal: { kind: 'NotAssignedToSite' } }]);
  });

  // Spec: backlog G.5 ; CdC « Une déclaration refusée n'est jamais perdue » (décision du 2026-11-08).
  it("des morts arrivés hors des trois jours sont refusés et gardés en base pour le chef : la déclaration entière, son motif, son auteur, son appareil, ses deux dates ; renvoyés, gardés une fois ; l'autre élevage ne les voit pas", async () => {
    const tropTard = envoi(90, { businessDate: '2026-11-01', recordedAt: '2026-11-05T18:30:00.000Z' });

    expect(await outcomesOf(await send({ events: [tropTard] }))).toEqual([{ index: 0, id: uuid(90), status: 'Refused', refusal: { kind: 'CatchUpWindowPassed' } }]);
    await outcomesOf(await send({ events: [tropTard] }));

    const kept = await db.superuser.refusedEvent.findMany({ where: { eventId: uuid(90) } });
    expect(kept).toEqual([
      expect.objectContaining({
        tenantId: TENANT_A,
        siteId: NORD,
        campaignId: BANDE_NORD,
        authorId: OUSMANE,
        deviceId: TELEPHONE,
        businessDate: new Date('2026-11-01'),
        recordedAt: new Date('2026-11-05T18:30:00.000Z'),
        receivedAt: expect.any(Date),
        event: { id: uuid(90), siteId: NORD, campaignId: BANDE_NORD, businessDate: '2026-11-01', recordedAt: '2026-11-05T18:30:00.000Z', fact: { type: 'Death', quantity: 3 } },
        refusal: { kind: 'CatchUpWindowPassed' },
      }),
    ]);
    // Under the application role, farm B sees none of it.
    const api = new PrismaService({ port: 0, databaseUrl: db.appUrl, jwtSecret: SECRET, mediaPath: '/data/medias' });
    try {
      expect(await api.runInTenant(unwrap(TenantId(TENANT_B)), (tx) => tx.refusedEvent.count())).toBe(0);
      expect(await api.runInTenant(unwrap(TenantId(TENANT_A)), (tx) => tx.refusedEvent.count({ where: { eventId: uuid(90) } }))).toBe(1);
    } finally {
      await api.$disconnect();
    }
  });

  it("un envoi illisible ou la bande d'un autre élevage ne laissent rien dans le registre des refus", async () => {
    const before = await db.superuser.refusedEvent.count();

    await outcomesOf(await send({ events: [{ id: 'pas-un-uuid' }, envoi(91, { siteId: SITE_DE_B, campaignId: BANDE_DE_B })] }));

    expect(await db.superuser.refusedEvent.count()).toBe(before);
  });

  it("le journal lu en base fait foi : « rien perdu » après des morts est refusé, une seconde annulation aussi", async () => {
    const rienPerdu = envoi(80, { recordedAt: '2026-11-05T19:00:00.000Z', fact: { type: 'NoLoss' } });
    const annule = (rank: number) => ({ ...Object.fromEntries(Object.entries(envoi(rank, { recordedAt: '2026-11-05T20:00:00.000Z' })).filter(([key]) => key !== 'fact')), retracts: uuid(1) });

    expect(await outcomesOf(await send({ events: [rienPerdu] }))).toEqual([{ index: 0, id: uuid(80), status: 'Refused', refusal: { kind: 'NoLossAfterDeaths' } }]);
    const gerant = tokenOf(LE_GERANT, TENANT_A, 'admin');
    expect(await outcomesOf(await send({ events: [annule(81)] }, gerant))).toEqual([{ index: 0, id: uuid(81), status: 'Accepted' }]);
    expect(await outcomesOf(await send({ events: [annule(82)] }, gerant))).toEqual([{ index: 0, id: uuid(82), status: 'Refused', refusal: { kind: 'DeclarationRetracted' } }]);
  });

  it("chaque type de fait, une correction et une annulation s'écrivent en base et se relisent à l'identique", async () => {
    // Given un lot qui porte un exemple de chaque forme, la correction et l'annulation avant leur déclaration
    const gerant = tokenOf(LE_GERANT, TENANT_A, 'admin');
    const facts = [
      { type: 'NoLoss' },
      { type: 'Loss', lossType: 'Donation', quantity: 2 },
      { type: 'Delivery', orderLineId: uuid(7), receivedQuantity: 40, deliveryNote: { kind: 'Photographed', media: MEDIA } },
      { type: 'Delivery', orderLineId: uuid(8), receivedQuantity: 40, deliveryNote: { kind: 'NoPaper' } },
      { type: 'Weighing', weighingRequestId: uuid(9), weights: [1820, 1905, 1760, 1880, 1850] },
      { type: 'TaskDone', taskId: uuid(12) },
      { type: 'VoiceMessage', media: MEDIA },
      { type: 'Photo', media: MEDIA },
      { type: 'Loss', lossType: 'Theft', quantity: 3 },
      // The admin validates the weighing above, sent earlier in the same batch (T.5).
      { type: 'WeighingValidated', weighingId: uuid(304) },
    ];
    const day = { businessDate: '2026-11-04', recordedAt: '2026-11-04T08:00:00.000Z' };
    const declarations = facts.map((fact, offset) => envoi(300 + offset, { ...day, fact }));
    const corrige = envoi(320, { ...day, corrects: uuid(301), recordedAt: '2026-11-04T09:00:00.000Z', fact: { type: 'Loss', lossType: 'Donation', quantity: 3 } });
    const annule = { ...Object.fromEntries(Object.entries(envoi(321, { ...day, recordedAt: '2026-11-04T10:00:00.000Z' })).filter(([key]) => key !== 'fact')), retracts: uuid(307) };
    const sent = [corrige, annule, ...declarations];

    // When
    const outcomes = await outcomesOf(await send({ events: sent }, gerant));

    // Then tout est accepté, et chaque événement relu en base est celui que le domaine a décodé de l'envoi
    expect(outcomes.every((outcome) => (outcome as { status: string }).status === 'Accepted')).toBe(true);
    const api = new PrismaService({ port: 0, databaseUrl: db.appUrl, jwtSecret: SECRET, mediaPath: '/data/medias' });
    try {
      const tenantId = unwrap(TenantId(TENANT_A));
      for (const raw of sent) {
        const expected = unwrap(decodeJournalEvent(raw, { tenantId, authorId: unwrap(UserId(LE_GERANT)) }));
        const read = await api.runInTenant(tenantId, (tx) => new PrismaJournal(tx, tenantId).event(expected.id));
        expect(read).toEqual(expected);
      }
    } finally {
      await api.$disconnect();
    }
  });

  describe('le corps de la requête', () => {
    it("porte exactement la liste des événements : autre chose est refusé en 400, sans rien écrire", async () => {
      const before = (await rowsOf(TENANT_A)).length;

      for (const body of [[envoi(90)], {}, { events: envoi(90) }, { events: [envoi(90)], tenantId: TENANT_B }]) {
        expect((await send(body)).status).toBe(400);
      }
      expect(await rowsOf(TENANT_A)).toHaveLength(before);
    });

    it(`un lot de plus de ${MAX_EVENTS_PER_BATCH} événements est refusé en entier (413), sans rien écrire ; à la limite, il passe`, async () => {
      const before = (await rowsOf(TENANT_A)).length;
      const batch = (size: number) => ({ events: Array.from({ length: size }, (_, offset) => envoi(1_000 + offset, { fact: { type: 'BagOpened', quantity: 1 } })) });

      expect((await send(batch(MAX_EVENTS_PER_BATCH + 1))).status).toBe(413);
      expect(await rowsOf(TENANT_A)).toHaveLength(before);
      expect((await send(batch(MAX_EVENTS_PER_BATCH))).status).toBe(200);
    });

    it('sans session, la route est fermée', async () => {
      const response = await fetch(`${origin}/api/v1/journal/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ events: [envoi(95)] }) });

      expect(response.status).toBe(401);
    });
  });
});
