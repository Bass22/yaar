import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { unwrap, type Clock } from '@kit';
import { Instant } from '@domain/journal';
import type { PriceCatalogView } from '@contracts';
import { AppModule } from '../app.module';
import { issueAccessToken, type SessionClaims } from '../auth/access-token';
import { CLOCK } from '../auth/auth.module';
import { APP_CONFIG } from '../config/app-config';
import { configureApp } from '../create-app';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';

// Spec: backlog N.5 — le catalogue de prix apprend seul ; cahier des charges « Valeurs par défaut »
// (décisions du fondateur du 2026-11-13 : vide au départ, il apprend des commandes ; par article et
// par fournisseur ; un prix fixé à la main compte à sa date). PostgreSQL réel, HTTP.
jest.setTimeout(180_000);

const SECRET = 'un-secret-de-test-assez-long-pour-signer-des-jetons';
const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT = uuid(10);
const NORD = uuid(3);
const BANDE = uuid(4);
const SEDIMA = uuid(31);
const TOUBA = uuid(32);
const MOUSSA = uuid(33);
const DEMARRAGE = uuid(43);
const POUSSINS = uuid(42);
const OUSMANE = uuid(51);
const LE_GERANT = uuid(54);
const ORDINATEUR = uuid(92);
const PIN_HASH = '$argon2id$v=19$m=19456,t=2,p=1$dGVzdC1vbmx5LXNhbHQ$dGVzdC1vbmx5LWRpZ2VzdC1ub3QtYS1yZWFsLXBpbg';

describe('Le catalogue de prix, au bureau', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let origin: string;
  const now = Date.parse('2026-11-13T10:00:00.000Z');
  const clock: Clock = { now: () => new Date(now) };
  const tokenOf = (sub: string, role: SessionClaims['role']) => issueAccessToken({ sub, tenant: TENANT, role, device: ORDINATEUR }, unwrap(Instant(new Date(now - 60_000).toISOString())), SECRET);
  const call = (method: string, path: string, body?: unknown, token = tokenOf(LE_GERANT, 'admin')) =>
    fetch(`${origin}/api/v1/${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const catalogue = async () => (await (await call('GET', 'price-catalog')).json()) as PriceCatalogView;
  const fixe = (id: number, fields: object = {}, token = tokenOf(LE_GERANT, 'admin')) => call('POST', 'price-catalog', { id: uuid(id), costTypeId: DEMARRAGE, supplierId: null, unitPrice: 18_000, ...fields }, token);
  const refus = async (response: Response) => ({ status: response.status, kind: ((await response.json()) as { kind?: string }).kind });

  beforeAll(async () => {
    db = await createTestDatabase();
    await db.superuser.tenant.create({ data: { id: TENANT, name: 'Ferme', currency: 'XOF' } });
    await db.superuser.site.create({ data: { id: NORD, tenantId: TENANT, name: 'Poulailler Nord', timeZone: 'Africa/Dakar' } });
    await db.superuser.campaign.create({ data: { id: BANDE, tenantId: TENANT, siteId: NORD, placementDay: new Date('2026-10-12'), strain: 'Cobb500', plannedHeadcount: 1000, plannedDuration: 45 } });
    await db.superuser.user.createMany({
      data: [
        { id: OUSMANE, tenantId: TENANT, role: 'collaborator', phone: '+221770000001', name: 'Ousmane', pinHash: PIN_HASH },
        { id: LE_GERANT, tenantId: TENANT, role: 'admin', phone: '+221770000002', name: 'Le gérant', pinHash: PIN_HASH },
      ],
    });
    await db.superuser.counterparty.createMany({
      data: [
        { id: SEDIMA, tenantId: TENANT, kind: 'Supplier', name: 'Sedima', face: 'closed-bag' },
        { id: TOUBA, tenantId: TENANT, kind: 'Supplier', name: 'Touba Avicole', face: 'truck' },
        { id: MOUSSA, tenantId: TENANT, kind: 'Customer', name: 'Moussa', face: 'hen' },
      ],
    });
    await db.superuser.costType.createMany({
      data: [
        { id: DEMARRAGE, tenantId: TENANT, category: 'Feed', name: 'Aliment démarrage', behaviour: 'Variable' },
        { id: POUSSINS, tenantId: TENANT, category: 'Chicks', name: 'Poussins', behaviour: 'Variable' },
      ],
    });
    // The sac of démarrage at 17 500 F from Sedima on October 12th, at 16 000 F from Touba on November 1st.
    const commande = async (rank: number, supplierId: string, createdAt: string, unitPrice: number) => {
      await db.superuser.purchaseOrder.create({ data: { id: uuid(rank), tenantId: TENANT, supplierId, campaignId: BANDE, orderDay: new Date(createdAt.slice(0, 10)), currency: 'XOF', createdAt: new Date(createdAt) } });
      await db.superuser.orderLine.create({ data: { id: uuid(rank + 1), tenantId: TENANT, orderId: uuid(rank), position: 0, costTypeId: DEMARRAGE, quantity: 20, unitPrice } });
    };
    await commande(100, SEDIMA, '2026-10-12T09:00:00.000Z', 17_500);
    await commande(110, TOUBA, '2026-11-01T09:00:00.000Z', 16_000);

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

  it('le catalogue apprend des commandes : chaque prix payé, par article et par fournisseur, à sa date ; rien d’inventé', async () => {
    expect(await catalogue()).toEqual({
      currency: 'XOF',
      prices: [
        { costTypeId: DEMARRAGE, supplierId: SEDIMA, unitPrice: 17_500, at: '2026-10-12T09:00:00.000Z' },
        { costTypeId: DEMARRAGE, supplierId: TOUBA, unitPrice: 16_000, at: '2026-11-01T09:00:00.000Z' },
      ],
    });
  });

  it('l’admin fixe un prix à la main, pour tous les fournisseurs ou pour un seul : il compte à sa date ; c’est tracé', async () => {
    expect((await fixe(200)).status).toBe(204);
    expect((await fixe(201, { supplierId: SEDIMA, unitPrice: 19_000 })).status).toBe(204);

    const prices = (await catalogue()).prices;
    expect(prices).toContainEqual({ costTypeId: DEMARRAGE, supplierId: null, unitPrice: 18_000, at: '2026-11-13T10:00:00.000Z' });
    expect(prices).toContainEqual({ costTypeId: DEMARRAGE, supplierId: SEDIMA, unitPrice: 19_000, at: '2026-11-13T10:00:00.000Z' });
    expect(await db.superuser.auditEvent.count({ where: { action: 'CatalogPriceSet', actorId: LE_GERANT, deviceId: ORDINATEUR } })).toBe(2);
  });

  it.each([
    ['un type inconnu', { costTypeId: uuid(99) }, 'UnknownCostType'],
    ['un client à la place d’un fournisseur', { supplierId: MOUSSA }, 'UnknownSupplier'],
    ['un prix négatif', { unitPrice: -1 }, 'InvalidPrice'],
    ['un prix à virgule', { unitPrice: 17_500.5 }, 'InvalidPrice'],
  ])('un prix refusé n’écrit rien : %s', async (_label, fields, kind) => {
    const before = await db.superuser.catalogPrice.count();
    expect(await refus(await fixe(210, fields))).toEqual({ status: 400, kind });
    expect(await db.superuser.catalogPrice.count()).toBe(before);
  });

  it('un prix à zéro se fixe : un don, un échantillon', async () => {
    expect((await fixe(220, { costTypeId: POUSSINS, unitPrice: 0 })).status).toBe(204);
  });

  it('une demande mal formée est refusée ; le même identifiant deux fois aussi', async () => {
    expect(await refus(await call('POST', 'price-catalog', { id: uuid(230), costTypeId: DEMARRAGE, unitPrice: 1 }))).toEqual({ status: 400, kind: 'InvalidRequest' });
    expect(await refus(await call('POST', 'price-catalog', { id: 'prix', costTypeId: DEMARRAGE, supplierId: null, unitPrice: 1 }))).toEqual({ status: 400, kind: 'InvalidRequest' });
    expect(await refus(await fixe(200))).toEqual({ status: 409, kind: 'CatalogPriceAlreadySet' });
  });

  it('le gardien ne lit ni ne fixe aucun prix', async () => {
    expect((await call('GET', 'price-catalog', undefined, tokenOf(OUSMANE, 'collaborator'))).status).toBe(403);
    expect((await fixe(240, {}, tokenOf(OUSMANE, 'collaborator'))).status).toBe(403);
  });
});
