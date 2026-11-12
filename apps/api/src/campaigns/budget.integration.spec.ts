import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { unwrap, type Clock } from '@kit';
import { Instant } from '@domain/journal';
import type { BudgetView, CampaignMoneyView, LedgerView } from '@contracts';
import { AppModule } from '../app.module';
import { issueAccessToken, type SessionClaims } from '../auth/access-token';
import { CLOCK } from '../auth/auth.module';
import { APP_CONFIG } from '../config/app-config';
import { configureApp } from '../create-app';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';

// Spec: backlog S.1 — le budget est un plan, jamais une dette ; cahier des charges « Budget de
// campagne » (décisions du fondateur du 2026-11-12) ; CLAUDE.md §4 règles 4, 5, 8 et 14.
// PostgreSQL réel, HTTP. Les montants attendus sont calculés à la main.
jest.setTimeout(180_000);

const SECRET = 'un-secret-de-test-assez-long-pour-signer-des-jetons';
const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT = uuid(10);
const AUTRE_ELEVAGE = uuid(11);
const NORD = uuid(3);
const BANDE = uuid(4);
const CLOSE_1 = uuid(5);
const CLOSE_2 = uuid(6);
const CLOSE_3 = uuid(7);
const CLOSE_VIDE = uuid(8);
const BANDE_AILLEURS = uuid(9);
const EN_COURS = uuid(12);
const SEDIMA = uuid(31);
const POUSSINS = uuid(42);
const ALIMENT = uuid(43);
const SALAIRE = uuid(44);
const OUSMANE = uuid(51);
const LE_GERANT = uuid(54);
const ORDINATEUR = uuid(92);
const PIN_HASH = '$argon2id$v=19$m=19456,t=2,p=1$dGVzdC1vbmx5LXNhbHQ$dGVzdC1vbmx5LWRpZ2VzdC1ub3QtYS1yZWFsLXBpbg';

describe('Le budget d’une bande, au bureau', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let origin: string;
  const now = Date.parse('2026-11-04T10:00:00.000Z');
  let tick = 0;
  const clock: Clock = { now: () => new Date(now + (tick += 1000)) };
  const tokenOf = (sub: string, role: SessionClaims['role'], tenant = TENANT) => issueAccessToken({ sub, tenant, role, device: ORDINATEUR }, unwrap(Instant(new Date(now - 60_000).toISOString())), SECRET);
  const call = (method: string, path: string, body?: unknown, token = tokenOf(LE_GERANT, 'admin')) =>
    fetch(`${origin}/api/v1/${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const budget = async (campaignId = BANDE) => (await (await call('GET', `campaigns/${campaignId}/budget`)).json()) as BudgetView;
  const ligne = async (category: string, campaignId = BANDE) => (await budget(campaignId)).lines.find((line) => line.category === category);
  const ecrit = (id: number, lines: unknown, campaignId = BANDE, token = tokenOf(LE_GERANT, 'admin')) => call('PUT', `campaigns/${campaignId}/budget`, { id: uuid(id), lines }, token);
  const refus = async (response: Response) => ({ status: response.status, kind: ((await response.json()) as { kind?: string }).kind });

  beforeAll(async () => {
    db = await createTestDatabase();
    await db.superuser.tenant.createMany({ data: [{ id: TENANT, name: 'Ferme', currency: 'XOF' }, { id: AUTRE_ELEVAGE, name: 'Ailleurs', currency: 'XOF' }] });
    await db.superuser.site.createMany({ data: [{ id: NORD, tenantId: TENANT, name: 'Poulailler Nord', timeZone: 'Africa/Dakar' }, { id: uuid(2), tenantId: AUTRE_ELEVAGE, name: 'Là-bas', timeZone: 'Africa/Dakar' }] });
    const bande = (id: string, placementDay: string, fields: object = {}) => ({ id, tenantId: TENANT, siteId: NORD, placementDay: new Date(placementDay), strain: 'Cobb500', plannedHeadcount: 1000, plannedDuration: 45, ...fields });
    const closed = { closedAt: new Date('2026-10-01T10:00:00.000Z') };
    await db.superuser.campaign.createMany({
      data: [
        bande(BANDE, '2026-10-12', { plannedHeadcount: 1050 }),
        bande(CLOSE_1, '2026-06-01', closed),
        bande(CLOSE_2, '2026-07-01', closed),
        bande(CLOSE_3, '2026-08-01', closed),
        bande(CLOSE_VIDE, '2026-09-01', closed),
        bande(EN_COURS, '2026-10-20'),
        { ...bande(BANDE_AILLEURS, '2026-10-12'), tenantId: AUTRE_ELEVAGE, siteId: uuid(2) },
      ],
    });
    await db.superuser.user.createMany({
      data: [
        { id: OUSMANE, tenantId: TENANT, role: 'collaborator', phone: '+221770000001', name: 'Ousmane', pinHash: PIN_HASH },
        { id: LE_GERANT, tenantId: TENANT, role: 'admin', phone: '+221770000002', name: 'Le gérant', pinHash: PIN_HASH },
      ],
    });
    await db.superuser.counterparty.create({ data: { id: SEDIMA, tenantId: TENANT, kind: 'Supplier', name: 'Sedima', face: 'closed-bag' } });
    await db.superuser.costType.createMany({
      data: [
        { id: POUSSINS, tenantId: TENANT, category: 'Chicks', name: 'Poussins', behaviour: 'Variable' },
        { id: ALIMENT, tenantId: TENANT, category: 'Feed', name: 'Aliment', behaviour: 'Variable' },
        { id: SALAIRE, tenantId: TENANT, category: 'Labour', name: 'Salaire', behaviour: 'Fixed' },
      ],
    });
    // Each campaign: an order of chicks and feed, received; the closed ones are the history.
    // Chicks received: CLOSE_1 1 000, CLOSE_2 1 000, CLOSE_3 500, CLOSE_VIDE none, BANDE 1 000.
    // Feed: CLOSE_1 1 200 000 F, CLOSE_2 1 300 000 F, CLOSE_3 700 000 F, BANDE 20 bags × 15 000 = 300 000 F.
    const commande = async (rank: number, campaignId: string, chicks: number, feedBags: number, feedPrice: number) => {
      await db.superuser.purchaseOrder.create({ data: { id: uuid(rank), tenantId: TENANT, supplierId: SEDIMA, campaignId, orderDay: new Date('2026-06-01'), currency: 'XOF', announcedAt: new Date('2026-06-01T09:00:00.000Z') } });
      await db.superuser.orderLine.createMany({
        data: [
          { id: uuid(rank + 1), tenantId: TENANT, orderId: uuid(rank), position: 0, costTypeId: POUSSINS, quantity: Math.max(chicks, 1), unitPrice: 500 },
          { id: uuid(rank + 2), tenantId: TENANT, orderId: uuid(rank), position: 1, costTypeId: ALIMENT, quantity: feedBags, unitPrice: feedPrice },
        ],
      });
      const recu = (event: number, line: number, receivedQuantity: number) => ({
        id: uuid(event), tenantId: TENANT, siteId: NORD, campaignId, authorId: OUSMANE, deviceId: uuid(93), type: 'Delivery' as const,
        fact: { orderLineId: uuid(line), receivedQuantity, deliveryNote: { kind: 'NoPaper' } }, businessDate: new Date('2026-06-01'), recordedAt: new Date('2026-06-01T18:00:00.000Z'),
      });
      await db.superuser.journalEvent.createMany({ data: [...(chicks > 0 ? [recu(rank + 3, rank + 1, chicks)] : []), recu(rank + 4, rank + 2, feedBags)] });
    };
    await commande(100, CLOSE_1, 1000, 80, 15_000);
    await commande(110, CLOSE_2, 1000, 100, 13_000);
    await commande(120, CLOSE_3, 500, 50, 14_000);
    await commande(130, CLOSE_VIDE, 0, 10, 15_000);
    await commande(140, BANDE, 1000, 20, 15_000);
    // Another running campaign: 3 000 F of feed a chick. It is not history until it is closed.
    await commande(150, EN_COURS, 1000, 200, 15_000);
    // A wage of 150 000 F written for the running campaign.
    await db.superuser.cost.create({ data: { tenantId: TENANT, id: uuid(200), campaignId: BANDE, costTypeId: SALAIRE, spentOn: new Date('2026-10-20'), amount: 150_000, paymentKind: 'Paid', recordedAt: new Date('2026-10-20T08:00:00.000Z'), recordedBy: LE_GERANT } });

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

  it('sans budget écrit : chaque poste montre son engagé, la proposition de l’historique, ni budget ni écart', async () => {
    const view = await budget();

    expect(view).toMatchObject({ campaignId: BANDE, currency: 'XOF', plannedHeadcount: 1050, closed: false });
    expect(view.lines.map(({ category }) => category)).toEqual(['Feed', 'Chicks', 'Health', 'Bedding', 'Labour', 'Equipment', 'Cleaning', 'Transport', 'Processing', 'Utilities', 'FinancialCharges', 'Other']);
    // Aliment par poussin : 1 200, 1 300, 1 400 (700 000 ÷ 500) → médiane 1 300 × 1 050 = 1 365 000 F ;
    // la bande close sans poussin reçu ne compte pas, ni la bande encore en cours (3 000 par poussin). Engagé : 20 × 15 000 = 300 000 F
    expect(await ligne('Feed')).toEqual({ category: 'Feed', budget: null, suggested: 1_365_000, committed: 300_000, variance: null });
    // Poussins : 500 F par poussin partout → 500 × 1 050 = 525 000 F ; engagé 1 000 × 500 = 500 000 F
    expect(await ligne('Chicks')).toEqual({ category: 'Chicks', budget: null, suggested: 525_000, committed: 500_000, variance: null });
    // Main-d'œuvre : aucune bande close n'en a eu → rien de proposé ; engagé 150 000 F
    expect(await ligne('Labour')).toEqual({ category: 'Labour', budget: null, suggested: null, committed: 150_000, variance: null });
  });

  it('écrire un budget : chaque poste écrit montre son budget et l’écart budget − engagé, signé', async () => {
    expect((await ecrit(300, [{ category: 'Feed', amount: 1_365_000 }, { category: 'Labour', amount: 100_000 }])).status).toBe(204);

    // 1 365 000 − 300 000 = 1 065 000 F de marge ; 100 000 − 150 000 = −50 000 F : dépassé
    expect(await ligne('Feed')).toMatchObject({ budget: 1_365_000, variance: 1_065_000 });
    expect(await ligne('Labour')).toMatchObject({ budget: 100_000, variance: -50_000 });
    expect(await ligne('Chicks')).toMatchObject({ budget: null, variance: null });
  });

  it('le dernier budget écrit fait foi, poste par poste ; un poste se retire du budget ; rien ne s’efface', async () => {
    expect((await ecrit(301, [{ category: 'Labour', amount: 200_000 }])).status).toBe(204);
    expect((await ecrit(302, [{ category: 'Feed', amount: null }])).status).toBe(204);

    expect(await ligne('Labour')).toMatchObject({ budget: 200_000, variance: 50_000 });
    expect(await ligne('Feed')).toMatchObject({ budget: null, variance: null });
    expect(await db.superuser.budgetLine.count({ where: { campaignId: BANDE } })).toBe(4);
  });

  it('le budget ne touche ni l’engagé ni le grand livre des tiers', async () => {
    expect(((await (await call('GET', `campaigns/${BANDE}/money`)).json()) as CampaignMoneyView).committed).toBe(950_000);
    const ledger = (await (await call('GET', 'ledger')).json()) as LedgerView;
    expect(JSON.stringify(ledger)).not.toContain('1365000');
  });

  it('chaque écriture du budget est tracée', async () => {
    expect(await db.superuser.auditEvent.count({ where: { action: 'BudgetRecorded', subjectId: BANDE, actorId: LE_GERANT, deviceId: ORDINATEUR } })).toBe(3);
  });

  it.each([
    ['un montant négatif', [{ category: 'Feed', amount: -1 }], 'InvalidAmount'],
    ['un montant à virgule', [{ category: 'Feed', amount: 1.5 }], 'InvalidAmount'],
    ['un poste inconnu', [{ category: 'Aliment', amount: 1 }], 'UnknownCategory'],
    ['un poste en double', [{ category: 'Feed', amount: 1 }, { category: 'Feed', amount: 2 }], 'DuplicateCategory'],
  ])('un budget refusé n’écrit rien : %s', async (_label, lines, kind) => {
    const before = await db.superuser.budgetLine.count();
    expect(await refus(await ecrit(310, lines))).toEqual({ status: 400, kind });
    expect(await db.superuser.budgetLine.count()).toBe(before);
  });

  it('une écriture déjà reçue sous le même identifiant est refusée', async () => {
    expect(await refus(await ecrit(300, [{ category: 'Feed', amount: 1 }]))).toEqual({ status: 409, kind: 'BudgetAlreadyRecorded' });
  });

  it.each([
    ['un champ en trop', { id: uuid(320), lines: [], note: 'x' }],
    ['un identifiant mal formé', { id: 'budget', lines: [] }],
    ['des lignes qui ne sont pas une liste', { id: uuid(321), lines: 'Feed' }],
  ])('une demande mal formée est refusée : %s', async (_label, body) => {
    expect(await refus(await call('PUT', `campaigns/${BANDE}/budget`, body))).toEqual({ status: 400, kind: 'InvalidRequest' });
  });

  it('une bande close montre son budget, mais ne se budgète plus', async () => {
    expect((await budget(CLOSE_1)).closed).toBe(true);
    expect(await refus(await ecrit(330, [{ category: 'Feed', amount: 1 }], CLOSE_1))).toEqual({ status: 409, kind: 'CampaignClosed' });
  });

  it('le gardien ne lit ni n’écrit le budget ; une bande d’un autre élevage est introuvable', async () => {
    expect((await call('GET', `campaigns/${BANDE}/budget`, undefined, tokenOf(OUSMANE, 'collaborator'))).status).toBe(403);
    expect((await ecrit(340, [], BANDE, tokenOf(OUSMANE, 'collaborator'))).status).toBe(403);
    expect((await call('GET', `campaigns/${BANDE_AILLEURS}/budget`)).status).toBe(404);
    expect((await ecrit(341, [], BANDE_AILLEURS)).status).toBe(404);
  });
});
