import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { unwrap, type Clock } from '@kit';
import { Instant } from '@domain/journal';
import type { CampaignMoneyView, RecordCostRequest } from '@contracts';
import { AppModule } from '../app.module';
import { issueAccessToken, type SessionClaims } from '../auth/access-token';
import { CLOCK } from '../auth/auth.module';
import { APP_CONFIG } from '../config/app-config';
import { configureApp } from '../create-app';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';

// Spec: backlog P.3 — l'API des coûts ; cahier des charges « Les dépenses » (décisions du
// 2026-11-12) ; CLAUDE.md §4 règles 2, 4, 5, 7, 8 et 14. PostgreSQL réel, HTTP.
jest.setTimeout(180_000);

const SECRET = 'un-secret-de-test-assez-long-pour-signer-des-jetons';
const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT_A = uuid(10);
const TENANT_B = uuid(11);
const NORD = uuid(3);
const SITE_DE_B = uuid(33);
const BANDE = uuid(4);
const VIEILLE_BANDE = uuid(5);
const BANDE_DE_B = uuid(6);
const SEDIMA = uuid(31);
const OUSMANE_TIERS = uuid(32);
const RAMASSEUR = uuid(34);
const ALIMENT = uuid(41);
const POUSSINS = uuid(42);
const SALAIRE = uuid(43);
const EAU = uuid(44);
const DEPLUMAGE = uuid(45);
const EAU_DE_B = uuid(46);
const OUSMANE = uuid(51);
const LE_GERANT = uuid(54);
const GERANT_DE_B = uuid(55);
const ORDINATEUR = uuid(92);
const MEDIA = 'd'.repeat(64);
const PIN_HASH = '$argon2id$v=19$m=19456,t=2,p=1$dGVzdC1vbmx5LXNhbHQ$dGVzdC1vbmx5LWRpZ2VzdC1ub3QtYS1yZWFsLXBpbg';

describe('Les coûts, au bureau', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let origin: string;
  // Thursday November 12th, 2026, 10:00 in Dakar.
  const now = Date.parse('2026-11-12T10:00:00.000Z');
  let tick = 0;
  const clock: Clock = { now: () => new Date(now + (tick += 1000)) };

  const tokenOf = (sub: string, tenant: string, role: SessionClaims['role']) =>
    issueAccessToken({ sub, tenant, role, device: ORDINATEUR }, unwrap(Instant(new Date(now - 60_000).toISOString())), SECRET);
  const gerant = () => tokenOf(LE_GERANT, TENANT_A, 'admin');
  type Token = ReturnType<typeof gerant>;
  const call = (method: string, path: string, body?: unknown, token: Token = gerant()) =>
    fetch(`${origin}/api/v1/${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const ecrit = (body: unknown, token?: Token) => call('POST', 'costs', body, token);
  const corrige = (id: string, body: unknown, token?: Token) => call('POST', `costs/${id}/revisions`, body, token);
  const argent = async (campaignId = BANDE, token?: Token) => (await (await call('GET', `campaigns/${campaignId}/money`, undefined, token)).json()) as CampaignMoneyView;
  const kindOf = async (response: Response) => ((await response.json()) as { kind?: string }).kind;
  const traceOf = (subjectId: string) => db.superuser.auditEvent.findMany({ where: { subjectId }, select: { action: true, actorId: true, deviceId: true, siteId: true } });

  // The water bill of November 10th: 12 500 F, paid.
  const unCout = (rank: number, fields: Partial<RecordCostRequest> = {}): RecordCostRequest => ({
    id: uuid(rank),
    campaignId: BANDE,
    costTypeId: EAU,
    spentOn: '2026-11-10',
    amount: 12_500,
    note: null,
    payment: { kind: 'Paid' },
    receipt: null,
    ...fields,
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
        { id: BANDE, tenantId: TENANT_A, siteId: NORD, placementDay: new Date('2026-11-01'), strain: 'Cobb500', plannedHeadcount: 1000, plannedDuration: 45 },
        { id: VIEILLE_BANDE, tenantId: TENANT_A, siteId: NORD, placementDay: new Date('2026-07-01'), strain: 'Cobb500', plannedHeadcount: 1000, plannedDuration: 45, closedAt: new Date('2026-08-20T10:00:00.000Z') },
        { id: BANDE_DE_B, tenantId: TENANT_B, siteId: SITE_DE_B, placementDay: new Date('2026-11-01'), strain: 'Cobb500', plannedHeadcount: 1000, plannedDuration: 45 },
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
        { id: OUSMANE_TIERS, tenantId: TENANT_A, kind: 'Collaborator', name: 'Ousmane', face: 'caretaker' },
        { id: RAMASSEUR, tenantId: TENANT_A, kind: 'Customer', name: 'Ramasseur', face: 'hen' },
      ],
    });
    await db.superuser.costType.createMany({
      data: [
        { id: ALIMENT, tenantId: TENANT_A, category: 'Feed', name: 'Aliment', behaviour: 'Variable' },
        { id: POUSSINS, tenantId: TENANT_A, category: 'Chicks', name: 'Poussins', behaviour: 'Variable' },
        { id: SALAIRE, tenantId: TENANT_A, category: 'Labour', name: 'Salaire du gardien', behaviour: 'Fixed' },
        { id: EAU, tenantId: TENANT_A, category: 'Utilities', name: 'Eau et électricité', behaviour: 'Variable' },
        { id: DEPLUMAGE, tenantId: TENANT_A, category: 'Processing', name: 'Déplumage', behaviour: 'Variable', archivedAt: new Date('2026-11-01T00:00:00.000Z') },
        { id: EAU_DE_B, tenantId: TENANT_B, category: 'Utilities', name: 'Eau', behaviour: 'Variable' },
      ],
    });
    // The order of 12/10, received whole: 20 × 17 500 + 1 000 × 550 = 900 000 F billable; 1 000 chicks, 3 deaths.
    await db.superuser.purchaseOrder.create({ data: { id: uuid(20), tenantId: TENANT_A, supplierId: SEDIMA, campaignId: BANDE, orderDay: new Date('2026-11-01'), currency: 'XOF', announcedAt: new Date('2026-11-01T09:00:00.000Z') } });
    await db.superuser.orderLine.createMany({
      data: [
        { id: uuid(21), tenantId: TENANT_A, orderId: uuid(20), position: 0, costTypeId: ALIMENT, quantity: 20, unitPrice: 17_500 },
        { id: uuid(22), tenantId: TENANT_A, orderId: uuid(20), position: 1, costTypeId: POUSSINS, quantity: 1000, unitPrice: 550 },
      ],
    });
    const event = (rank: number, type: 'Delivery' | 'Death', fact: { [key: string]: string | number | { kind: string } }) => ({
      id: uuid(rank), tenantId: TENANT_A, siteId: NORD, campaignId: BANDE, authorId: OUSMANE, businessDate: new Date('2026-11-02'), recordedAt: new Date('2026-11-02T08:00:00.000Z'), deviceId: uuid(93), type, fact,
    });
    await db.superuser.journalEvent.createMany({
      data: [
        event(201, 'Delivery', { orderLineId: uuid(21), receivedQuantity: 20, deliveryNote: { kind: 'NoPaper' } }),
        event(202, 'Delivery', { orderLineId: uuid(22), receivedQuantity: 1000, deliveryNote: { kind: 'NoPaper' } }),
        event(203, 'Death', { quantity: 3 }),
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

  it("avant toute dépense, l'engagé est le facturable des commandes ; le coût par poulet divise par les poussins reçus moins 7 % de pertes prévues", async () => {
    // 1 000 received, 3 dead: 930 birds expected; 900 000 ÷ 930 = 967,7… → 968 F.
    expect(await argent()).toEqual({ campaignId: BANDE, currency: 'XOF', committed: 900_000, liveCount: 997, costPerBird: 968, costs: [] });
  });

  it("l'admin écrit un coût : il compte dans l'engagé, la dépense est tracée", async () => {
    expect((await ecrit(unCout(301, { note: 'Facture SDE, payée au guichet' }))).status).toBe(201);

    // 900 000 + 12 500 = 912 500 F ; ÷ 930 = 981,1… → 981 F.
    const money = await argent();
    expect(money).toMatchObject({ committed: 912_500, costPerBird: 981 });
    expect(money.costs).toEqual([
      {
        id: uuid(301),
        costTypeId: EAU,
        spentOn: '2026-11-10',
        amount: 12_500,
        note: 'Facture SDE, payée au guichet',
        payment: { kind: 'Paid' },
        receipt: null,
        history: [{ id: uuid(301), recordedAt: expect.any(String), recordedBy: LE_GERANT, amount: 12_500, spentOn: '2026-11-10', payment: { kind: 'Paid' } }],
      },
    ]);
    expect(await traceOf(uuid(301))).toEqual([{ action: 'CostRecorded', actorId: LE_GERANT, deviceId: ORDINATEUR, siteId: NORD }]);
  });

  it('un coût « à payer » compte dans l’engagé comme un coût payé, et nomme son tiers', async () => {
    expect((await ecrit(unCout(302, { costTypeId: SALAIRE, amount: 45_000, spentOn: '2026-11-12', payment: { kind: 'ToPay', counterpartyId: OUSMANE_TIERS } }))).status).toBe(201);

    const money = await argent();
    expect(money.committed).toBe(957_500);
    expect(money.costs.find(({ id }) => id === uuid(302))?.payment).toEqual({ kind: 'ToPay', counterpartyId: OUSMANE_TIERS });
  });

  it('le même coût renvoyé ne compte qu’une fois (200) ; le même identifiant avec un autre montant est refusé (409)', async () => {
    expect((await ecrit(unCout(301, { note: 'Facture SDE, payée au guichet' }))).status).toBe(200);
    const autre = await ecrit(unCout(301, { note: 'Facture SDE, payée au guichet', amount: 99_000 }));

    expect([autre.status, await kindOf(autre)]).toEqual([409, 'CostAlreadyExists']);
    expect((await argent()).committed).toBe(957_500);
    expect(await traceOf(uuid(301))).toHaveLength(1);
  });

  it('une contre-écriture remplace le coût ; l’écriture d’origine reste dans l’historique ; l’engagé suit la dernière valeur ; tracée', async () => {
    expect((await corrige(uuid(301), unCout(311, { amount: 13_200, note: 'Montant relu sur la facture' }))).status).toBe(201);

    const money = await argent();
    const eau = money.costs.find(({ id }) => id === uuid(301));
    expect(eau).toMatchObject({ amount: 13_200, note: 'Montant relu sur la facture' });
    expect(eau?.history.map(({ id, amount }) => [id, amount])).toEqual([
      [uuid(301), 12_500],
      [uuid(311), 13_200],
    ]);
    // 900 000 + 13 200 + 45 000 = 958 200 F.
    expect(money.committed).toBe(958_200);
    expect((await traceOf(uuid(301))).map(({ action }) => action)).toEqual(['CostRecorded', 'CostRevised']);
  });

  it('une dépense mise en file porte sa date de saisie, lue sur l’appareil : la dernière écrite fait foi d’après elle, pas d’après son arrivée (P.7)', async () => {
    expect((await ecrit({ ...unCout(370, { amount: 1_000 }), recordedAt: '2026-11-11T08:00:00.000Z' })).status).toBe(201);
    // Written at 09:00 on the device, received first; written at 08:30, received second.
    expect((await corrige(uuid(370), { ...unCout(371, { amount: 3_000 }), recordedAt: '2026-11-11T09:00:00.000Z' })).status).toBe(201);
    expect((await corrige(uuid(370), { ...unCout(372, { amount: 2_000 }), recordedAt: '2026-11-11T08:30:00.000Z' })).status).toBe(201);

    const cost = (await argent()).costs.find(({ id }) => id === uuid(370));
    expect(cost?.amount).toBe(3_000);
    expect(cost?.history.map(({ id, recordedAt }) => [id, recordedAt])).toEqual([
      [uuid(370), '2026-11-11T08:00:00.000Z'],
      [uuid(372), '2026-11-11T08:30:00.000Z'],
      [uuid(371), '2026-11-11T09:00:00.000Z'],
    ]);
    const malDatee = await ecrit({ ...unCout(373), recordedAt: 'hier' });
    expect([malDatee.status, await kindOf(malDatee)]).toEqual([400, 'InvalidInstant']);
  });

  it('« à payer » → payé en une seule contre-écriture', async () => {
    expect((await corrige(uuid(302), unCout(312, { costTypeId: SALAIRE, amount: 45_000, spentOn: '2026-11-12', payment: { kind: 'Paid' } }))).status).toBe(201);

    expect((await argent()).costs.find(({ id }) => id === uuid(302))?.payment).toEqual({ kind: 'Paid' });
  });

  it('les règles du domaine refusent (400, avec le motif) sans rien écrire', async () => {
    const refus = await Promise.all([
      ecrit(unCout(320, { amount: 0 })),
      ecrit(unCout(321, { spentOn: '2026-11-13' })),
      ecrit(unCout(322, { costTypeId: DEPLUMAGE })),
      ecrit(unCout(323, { costTypeId: EAU_DE_B })),
      ecrit(unCout(324, { payment: { kind: 'ToPay', counterpartyId: RAMASSEUR } })),
      ecrit({ ...unCout(325), tenantId: TENANT_B }),
      ecrit({ ...unCout(326), amount: '12500' }),
      ecrit(unCout(327, { receipt: 'photo.jpg' })),
      corrige(uuid(301), unCout(328, { campaignId: VIEILLE_BANDE })),
      corrige(uuid(311), unCout(329)),
    ]);

    expect(await Promise.all(refus.map(async (response) => [response.status, await kindOf(response)]))).toEqual([
      [400, 'InvalidAmount'],
      [400, 'SpentInFuture'],
      [400, 'CostTypeArchived'],
      [400, 'UnknownCostType'],
      [400, 'NotACreditor'],
      [400, 'InvalidRequest'],
      [400, 'InvalidRequest'],
      [400, 'InvalidMediaFingerprint'],
      [400, 'CorrectionChangesCampaign'],
      [400, 'CorrectsACorrection'],
    ]);
    expect(await db.superuser.cost.count({ where: { id: { in: [320, 321, 322, 323, 324, 325, 326, 327, 328, 329].map(uuid) } } })).toBe(0);
  });

  it('une bande close ou inconnue ne reçoit pas de coût (400) ; corriger un coût inconnu : 404', async () => {
    const refus = [await ecrit(unCout(330, { campaignId: VIEILLE_BANDE })), await ecrit(unCout(331, { campaignId: uuid(99) }))];

    expect(await Promise.all(refus.map(async (response) => [response.status, await kindOf(response)]))).toEqual([
      [400, 'CampaignClosed'],
      [400, 'UnknownCampaign'],
    ]);
    expect((await corrige(uuid(399), unCout(332))).status).toBe(404);
  });

  it("le reçu cité par un coût se relit par l'admin (P.5) : un coût est un lieu de citation, comme le journal", async () => {
    await db.superuser.media.create({ data: { tenantId: TENANT_A, sha256: MEDIA, byteSize: 10, contentType: 'image/jpeg', retentionClass: 'SupportingDocument', uploadedBy: LE_GERANT, deviceId: ORDINATEUR, uploadedAt: new Date(now) } });
    expect((await ecrit(unCout(340, { receipt: MEDIA }))).status).toBe(201);

    expect((await argent()).costs.find(({ id }) => id === uuid(340))?.receipt).toBe(MEDIA);
  });

  it("les coûts d'un autre élevage ne se voient pas ; sa bande n'existe pas ici (404)", async () => {
    expect((await ecrit(unCout(350, { campaignId: BANDE_DE_B, costTypeId: EAU_DE_B }), tokenOf(GERANT_DE_B, TENANT_B, 'admin'))).status).toBe(201);

    expect((await call('GET', `campaigns/${BANDE_DE_B}/money`)).status).toBe(404);
    expect((await argent()).costs.map(({ id }) => id)).not.toContain(uuid(350));
  });

  it('un gardien reçoit un refus sur toute route de coûts (403) : ni montant, ni liste, ne lui parviennent', async () => {
    const gardien = tokenOf(OUSMANE, TENANT_A, 'collaborator');
    const statuses = [await ecrit(unCout(360), gardien), await corrige(uuid(301), unCout(361), gardien), await call('GET', `campaigns/${BANDE}/money`, undefined, gardien)];

    expect(statuses.map((response) => response.status)).toEqual([403, 403, 403]);
  });
});
