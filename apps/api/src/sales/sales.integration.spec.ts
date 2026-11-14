import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { unwrap, type Clock } from '@kit';
import { Instant } from '@domain/journal';
import type { CaretakerContext, LedgerView, RecordSaleRequest, SalesView } from '@contracts';
import { AppModule } from '../app.module';
import { issueAccessToken, type SessionClaims } from '../auth/access-token';
import { CLOCK } from '../auth/auth.module';
import { APP_CONFIG } from '../config/app-config';
import { configureApp } from '../create-app';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';

// Spec: backlog W.3 — saisir une vente ; cahier des charges « Les ventes » (décisions du 2026-11-12) ;
// CLAUDE.md §4 règles 2, 4, 5, 8 et 14. PostgreSQL réel, HTTP. Montants calculés à la main.
jest.setTimeout(180_000);

const SECRET = 'un-secret-de-test-assez-long-pour-signer-des-jetons';
const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT = uuid(10);
const NORD = uuid(3);
const BANDE = uuid(4);
const VIEILLE_BANDE = uuid(5);
const SEDIMA = uuid(31);
const MOUSSA = uuid(33);
const POUSSINS = uuid(42);
const OUSMANE = uuid(51);
const LE_GERANT = uuid(54);
const ORDINATEUR = uuid(92);
const PIN_HASH = '$argon2id$v=19$m=19456,t=2,p=1$dGVzdC1vbmx5LXNhbHQ$dGVzdC1vbmx5LWRpZ2VzdC1ub3QtYS1yZWFsLXBpbg';

describe('Les ventes, au bureau', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let origin: string;
  // Wednesday November 25th, 2026, 10:00 in Dakar.
  const now = Date.parse('2026-11-25T10:00:00.000Z');
  let tick = 0;
  const clock: Clock = { now: () => new Date(now + (tick += 1000)) };
  const tokenOf = (sub: string, role: SessionClaims['role']) => issueAccessToken({ sub, tenant: TENANT, role, device: ORDINATEUR }, unwrap(Instant(new Date(now - 60_000).toISOString())), SECRET);
  const gerant = () => tokenOf(LE_GERANT, 'admin');
  const call = (method: string, path: string, body?: unknown, token = gerant()) =>
    fetch(`${origin}/api/v1/${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const ventes = async () => (await (await call('GET', `campaigns/${BANDE}/sales`)).json()) as SalesView;
  const soldeDeMoussa = async () => ((await (await call('GET', 'ledger')).json()) as LedgerView).counterparties.find(({ counterpartyId }) => counterpartyId === MOUSSA)?.balance;
  const vivantsDuGardien = async () => ((await (await call('GET', 'caretaker/context', undefined, tokenOf(OUSMANE, 'collaborator'))).json()) as CaretakerContext).sites[0]?.campaigns[0]?.liveCount;
  const kindOf = async (response: Response) => ((await response.json()) as { kind?: string }).kind;
  // 200 birds at 2 750 F a head to Moussa, 200 000 F received at once in cash.
  const uneVente = (rank: number, fields: Partial<RecordSaleRequest> = {}): RecordSaleRequest => ({
    id: uuid(rank),
    campaignId: BANDE,
    buyerId: MOUSSA,
    soldOn: '2026-11-25',
    birds: 200,
    pricing: { kind: 'PerBird', unitPrice: 2_750 },
    receivedNow: { id: uuid(rank + 1000), amount: 200_000, method: 'Cash' },
    ...fields,
  });

  beforeAll(async () => {
    db = await createTestDatabase();
    await db.superuser.tenant.create({ data: { id: TENANT, name: 'Ferme', currency: 'XOF' } });
    await db.superuser.site.create({ data: { id: NORD, tenantId: TENANT, name: 'Poulailler Nord', timeZone: 'Africa/Dakar' } });
    await db.superuser.campaign.createMany({
      data: [
        { id: BANDE, tenantId: TENANT, siteId: NORD, placementDay: new Date('2026-10-12'), strain: 'Cobb500', plannedHeadcount: 1000, plannedDuration: 45 },
        { id: VIEILLE_BANDE, tenantId: TENANT, siteId: NORD, placementDay: new Date('2026-07-01'), strain: 'Cobb500', plannedHeadcount: 1000, plannedDuration: 45, closedAt: new Date('2026-08-20T10:00:00.000Z') },
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
    // 1 050 chicks received (1 000 ordered at 550 F: 550 000 F billable), 5 dead.
    await db.superuser.purchaseOrder.create({ data: { id: uuid(20), tenantId: TENANT, supplierId: SEDIMA, campaignId: BANDE, orderDay: new Date('2026-10-12'), currency: 'XOF', announcedAt: new Date('2026-10-12T09:00:00.000Z') } });
    await db.superuser.orderLine.create({ data: { id: uuid(21), tenantId: TENANT, orderId: uuid(20), position: 0, costTypeId: POUSSINS, quantity: 1000, unitPrice: 550 } });
    const event = (rank: number, type: 'Delivery' | 'Death', fact: { [key: string]: string | number | { kind: string } }) => ({
      id: uuid(rank), tenantId: TENANT, siteId: NORD, campaignId: BANDE, authorId: OUSMANE, businessDate: new Date('2026-10-16'), recordedAt: new Date('2026-10-16T08:00:00.000Z'), deviceId: uuid(93), type, fact,
    });
    await db.superuser.journalEvent.createMany({ data: [event(201, 'Delivery', { orderLineId: uuid(21), receivedQuantity: 1050, deliveryNote: { kind: 'NoPaper' } }), event(202, 'Death', { quantity: 5 })] });

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

  it('avant la première vente : rien de vendu, marge et prix moyen absents, le restant à vendre = les vivants', async () => {
    expect(await ventes()).toEqual({ campaignId: BANDE, currency: 'XOF', birdsSold: 0, revenue: 0, cashedIn: 0, margin: null, averagePrice: null, remaining: 1045, sales: [] });
  });

  it('une vente par tête, payée en partie : le reste est une créance sur l’acheteur ; les poulets vendus sortent des vivants du gardien ; tracée', async () => {
    expect((await call('POST', 'sales', uneVente(301))).status).toBe(201);

    // 200 × 2 750 = 550 000 F, 200 000 F received: Moussa owes 350 000 F. Alive: 1 045 − 200 = 845.
    const view = await ventes();
    expect(view).toMatchObject({ birdsSold: 200, revenue: 550_000, cashedIn: 200_000, remaining: 845, averagePrice: 2_750 });
    // Committed: the chicks' billable, 550 000 F; margin: 200 000 − 550 000 = −350 000 F.
    expect(view.margin).toBe(-350_000);
    expect(view.sales).toEqual([
      { id: uuid(301), buyerId: MOUSSA, soldOn: '2026-11-25', birds: 200, pricing: { kind: 'PerBird', unitPrice: 2_750 }, amount: 550_000, received: 200_000, receipts: [{ id: uuid(1301), paidOn: '2026-11-25', amount: 200_000, method: 'Cash' }] },
    ]);
    expect(await soldeDeMoussa()).toBe(350_000);
    expect(await vivantsDuGardien()).toBe(845);
    expect((await db.superuser.auditEvent.findMany({ where: { subjectId: uuid(301) }, select: { action: true } })).map(({ action }) => action)).toEqual(['SaleRecorded']);
  });

  it('une vente au kilo, à crédit : le montant se calcule — 452 300 g × 1 200 F = 542 760 F —, l’acheteur doit tout', async () => {
    expect((await call('POST', 'sales', uneVente(302, { birds: 180, pricing: { kind: 'PerKilo', grams: 452_300, pricePerKilo: 1_200 }, receivedNow: null }))).status).toBe(201);

    // 350 000 + 542 760 = 892 760 F owed by Moussa; revenue 1 092 760 F for 380 birds → 2 876 F.
    expect(await soldeDeMoussa()).toBe(892_760);
    expect(await ventes()).toMatchObject({ birdsSold: 380, revenue: 1_092_760, averagePrice: 2_876, remaining: 665 });
  });

  it('un encaissement plus tard, sur la vente, diminue la créance et compte dans l’encaissé ; renvoyé, il compte une fois', async () => {
    const encaissement = { id: uuid(401), paidOn: '2026-11-25', amount: 542_760, method: 'Wave' };
    expect((await call('POST', `sales/${uuid(302)}/receipts`, encaissement)).status).toBe(201);
    expect((await call('POST', `sales/${uuid(302)}/receipts`, encaissement)).status).toBe(200);

    expect(await soldeDeMoussa()).toBe(350_000);
    expect((await ventes()).cashedIn).toBe(742_760);
  });

  it('la même vente renvoyée ne compte qu’une fois (200) ; son identifiant avec un autre nombre de poulets est refusé (409)', async () => {
    expect((await call('POST', 'sales', uneVente(301))).status).toBe(200);
    const autre = await call('POST', 'sales', uneVente(301, { birds: 199 }));

    expect([autre.status, await kindOf(autre)]).toEqual([409, 'SaleAlreadyExists']);
    expect((await ventes()).birdsSold).toBe(380);
  });

  it('les règles refusent (400, avec le motif) sans rien écrire : un fournisseur pour acheteur, zéro poulet, un poids nul, une date future, une bande close, un champ en trop ; encaisser une vente inconnue : 404', async () => {
    const refus = await Promise.all([
      call('POST', 'sales', uneVente(310, { buyerId: SEDIMA })),
      call('POST', 'sales', uneVente(311, { birds: 0 })),
      call('POST', 'sales', uneVente(312, { pricing: { kind: 'PerKilo', grams: 0, pricePerKilo: 1_200 } })),
      call('POST', 'sales', uneVente(313, { soldOn: '2026-11-26' })),
      call('POST', 'sales', uneVente(314, { campaignId: VIEILLE_BANDE })),
      call('POST', 'sales', { ...uneVente(315), tenantId: uuid(11) }),
      call('POST', `sales/${uuid(399)}/receipts`, { id: uuid(402), paidOn: '2026-11-25', amount: 1_000, method: 'Cash' }),
    ]);

    expect(await Promise.all(refus.map(async (response) => [response.status, response.status === 404 ? null : await kindOf(response)]))).toEqual([
      [400, 'NotACustomer'],
      [400, 'InvalidBirds'],
      [400, 'InvalidWeight'],
      [400, 'SoldInFuture'],
      [400, 'CampaignClosed'],
      [400, 'InvalidRequest'],
      [404, null],
    ]);
    expect(await db.superuser.sale.count({ where: { id: { in: [310, 311, 312, 313, 314, 315].map(uuid) } } })).toBe(0);
  });

  it('un gardien reçoit un refus sur toute route de ventes (403) : aucun montant ne lui parvient ; son contexte n’en porte aucun', async () => {
    const gardien = tokenOf(OUSMANE, 'collaborator');
    expect([(await call('POST', 'sales', uneVente(320), gardien)).status, (await call('GET', `campaigns/${BANDE}/sales`, undefined, gardien)).status, (await call('POST', `sales/${uuid(301)}/receipts`, {}, gardien)).status]).toEqual([403, 403, 403]);
    const raw = await (await call('GET', 'caretaker/context', undefined, gardien)).text();
    expect(raw).not.toMatch(/sale|price|amount|Moussa|2750|550000/i);
  });
});
