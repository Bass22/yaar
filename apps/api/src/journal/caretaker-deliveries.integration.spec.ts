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

// Spec: backlog Q.6 — la livraison annoncée arrive chez le gardien ; cahier des charges « Livraison
// annoncée », « Commandes » (la livraison attendue au cahier : décision du 2026-11-09) ; CLAUDE.md §4
// règle 4 (need-to-know : ni prix, ni montant, ni fournisseur sur le téléphone). PostgreSQL réel, HTTP.
jest.setTimeout(180_000);

const SECRET = 'un-secret-de-test-assez-long-pour-signer-des-jetons';
const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT = uuid(10);
const NORD = uuid(3);
const BANDE = uuid(4);
const PETITS = uuid(5);
const SEDIMA = uuid(31);
const ALIMENT = uuid(41);
const POUSSINS = uuid(42);
const OUSMANE = uuid(51);
const ORDINATEUR = uuid(92);
const PIN_HASH = '$argon2id$v=19$m=19456,t=2,p=1$dGVzdC1vbmx5LXNhbHQ$dGVzdC1vbmx5LWRpZ2VzdC1ub3QtYS1yZWFsLXBpbg';

describe('La livraison annoncée, au cahier du gardien', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let origin: string;
  let context: CaretakerContext;
  let raw: string;
  // Wednesday October 14th, 2026, 10:00 in Dakar.
  const now = Date.parse('2026-10-14T10:00:00.000Z');
  const clock: Clock = { now: () => new Date(now) };
  const tokenOf = (sub: string, role: SessionClaims['role']) =>
    issueAccessToken({ sub, tenant: TENANT, role, device: ORDINATEUR }, unwrap(Instant(new Date(now - 60_000).toISOString())), SECRET);

  // An order of the campaign, with its lines: 20 bags of feed at 17 500 F and 1 000 chicks at 550 F.
  const uneCommande = async (rank: number, state: { announcedAt?: Date; closedAt?: Date } = {}, campaignId = BANDE) => {
    await db.superuser.purchaseOrder.create({ data: { id: uuid(rank), tenantId: TENANT, supplierId: SEDIMA, campaignId, orderDay: new Date('2026-10-12'), currency: 'XOF', reference: 'BC-0412', ...state } });
    await db.superuser.orderLine.createMany({
      data: [
        { id: uuid(rank * 10 + 1), tenantId: TENANT, orderId: uuid(rank), position: 0, costTypeId: ALIMENT, quantity: 20, unitPrice: 17_500 },
        { id: uuid(rank * 10 + 2), tenantId: TENANT, orderId: uuid(rank), position: 1, costTypeId: POUSSINS, quantity: 1000, unitPrice: 550 },
      ],
    });
  };
  const recoit = (rank: number, orderLineId: string, receivedQuantity: number) =>
    db.superuser.journalEvent.create({
      data: {
        id: uuid(rank),
        tenantId: TENANT,
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
    await db.superuser.tenant.create({ data: { id: TENANT, name: 'Ferme', currency: 'XOF' } });
    await db.superuser.site.create({ data: { id: NORD, tenantId: TENANT, name: 'Poulailler Nord', timeZone: 'Africa/Dakar' } });
    await db.superuser.campaign.createMany({
      data: [
        { id: BANDE, tenantId: TENANT, siteId: NORD, placementDay: new Date('2026-10-01'), strain: 'Cobb500', plannedHeadcount: 1000, plannedDuration: 45 },
        // A second flock on the same site, placed later: its orders are its own.
        { id: PETITS, tenantId: TENANT, siteId: NORD, placementDay: new Date('2026-10-12'), strain: 'Cobb500', plannedHeadcount: 1000, plannedDuration: 45 },
        // Two flocks opened ahead (O.5), placed on the 17th and the 20th: the first one has an order announced (Q.11).
        { id: uuid(80), tenantId: TENANT, siteId: NORD, placementDay: new Date('2026-10-17'), strain: 'Cobb500', plannedHeadcount: 1000, plannedDuration: 45 },
        { id: uuid(81), tenantId: TENANT, siteId: NORD, placementDay: new Date('2026-10-20'), strain: 'Cobb500', plannedHeadcount: 1000, plannedDuration: 45 },
      ],
    });
    await db.superuser.user.create({ data: { id: OUSMANE, tenantId: TENANT, role: 'collaborator', phone: '+221770000001', name: 'Ousmane', pinHash: PIN_HASH } });
    await db.superuser.siteAssignment.create({ data: { tenantId: TENANT, siteId: NORD, userId: OUSMANE, isPrimary: true } });
    await db.superuser.counterparty.create({ data: { id: SEDIMA, tenantId: TENANT, kind: 'Supplier', name: 'Sedima', face: 'closed-bag' } });
    await db.superuser.costType.createMany({
      data: [
        { id: ALIMENT, tenantId: TENANT, category: 'Feed', name: 'Aliment démarrage', behaviour: 'Variable', feedStage: 'Starter' },
        { id: POUSSINS, tenantId: TENANT, category: 'Chicks', name: 'Poussins Cobb', behaviour: 'Variable' },
      ],
    });
    // 1: a draft. 2: announced, 8 bags received. 3: announced, fully received (a bonus of chicks). 4: announced, then closed.
    await uneCommande(1);
    await uneCommande(2, { announcedAt: new Date('2026-10-12T09:00:00.000Z') });
    await uneCommande(3, { announcedAt: new Date('2026-10-12T09:05:00.000Z') });
    await uneCommande(4, { announcedAt: new Date('2026-10-12T09:10:00.000Z'), closedAt: new Date('2026-10-13T09:00:00.000Z') });
    // 5: announced for the second flock.
    await uneCommande(5, { announcedAt: new Date('2026-10-12T09:15:00.000Z') }, PETITS);
    // 6: announced for the flock still to come: litter and feed arrive before the chicks.
    await uneCommande(6, { announcedAt: new Date('2026-10-13T09:00:00.000Z') }, uuid(80));
    await recoit(201, uuid(21), 8);
    await recoit(301, uuid(31), 20);
    await recoit(302, uuid(32), 1050);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue({ port: 0, databaseUrl: db.appUrl, jwtSecret: SECRET })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.listen(0, '127.0.0.1');
    origin = await app.getUrl();
    const response = await fetch(`${origin}/api/v1/caretaker/context`, { headers: { Authorization: `Bearer ${tokenOf(OUSMANE, 'collaborator')}` } });
    raw = await response.text();
    context = JSON.parse(raw) as CaretakerContext;
  });

  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });

  const livraisons = () => context.sites[0]?.campaigns[0]?.deliveries;

  // N.9 : le stade de l'aliment donne au gardien la couleur du sac ; ailleurs, aucun
  it('une commande annoncée ajoute une livraison attendue à la bande : chaque ligne avec son type, son stade d’aliment, la quantité attendue, le reçu et le reste à venir', () => {
    expect(livraisons()).toEqual([
      {
        orderId: uuid(2),
        lines: [
          { orderLineId: uuid(21), name: 'Aliment démarrage', category: 'Feed', feedStage: 'Starter', expected: 20, received: 8, remaining: 12 },
          { orderLineId: uuid(22), name: 'Poussins Cobb', category: 'Chicks', feedStage: null, expected: 1000, received: 0, remaining: 1000 },
        ],
      },
    ]);
  });

  // Spec: backlog Q.11 (décision du fondateur du 2026-11-13)
  it('une bande à venir arrive au cahier avant J0 si une livraison est annoncée pour elle, et seulement alors', () => {
    const campaigns = context.sites[0]?.campaigns ?? [];
    const aVenir = campaigns.find(({ campaignId }) => campaignId === uuid(80));

    expect(aVenir?.campaignDay).toBe(-3);
    expect(aVenir?.deliveries.map(({ orderId }) => orderId)).toEqual([uuid(6)]);
    expect(campaigns.some(({ campaignId }) => campaignId === uuid(81))).toBe(false);
  });

  it("chaque bande n'attend que ses commandes : deux bandes sur un site ne se mélangent pas", () => {
    const parBande = Object.fromEntries((context.sites[0]?.campaigns ?? []).map((campaign) => [campaign.campaignId, campaign.deliveries.map(({ orderId }) => orderId)]));

    expect(parBande).toEqual({ [BANDE]: [uuid(2)], [PETITS]: [uuid(5)], [uuid(80)]: [uuid(6)] });
  });

  it("un brouillon n'ajoute aucune livraison ; une commande entièrement reçue, ou close, n'en a plus", () => {
    expect(livraisons()?.map(({ orderId }) => orderId)).toEqual([uuid(2)]);
  });

  it('garde du need-to-know : ni prix, ni montant, ni fournisseur, ni référence ne partent vers le téléphone', () => {
    expect(raw).not.toMatch(/price|unitPrice|amount|billable|currency|supplier/i);
    expect(raw).not.toContain('17500');
    expect(raw).not.toContain('Sedima');
    expect(raw).not.toContain('BC-0412');
  });
});
