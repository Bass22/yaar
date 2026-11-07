import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { unwrap, type Clock } from '@kit';
import { Instant } from '@domain/journal';
import type { CaretakerContext, CaretakerSite } from '@contracts';
import { Prisma } from '@prisma/client';
import { AppModule } from '../app.module';
import { issueAccessToken, type SessionClaims } from '../auth/access-token';
import { CLOCK } from '../auth/auth.module';
import { APP_CONFIG } from '../config/app-config';
import { configureApp } from '../create-app';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';

// Spec: Architecture §5 « Descente » ; cahier des charges « En-tête et contexte », « Journal du
// jour », « Rattrapage » ; CLAUDE.md §4 règle 4 (need-to-know : le téléphone du gardien ne reçoit
// rien de financier, filtré côté serveur) ; backlog F.3. PostgreSQL réel, serveur HTTP.
jest.setTimeout(180_000);

const SECRET = 'un-secret-de-test-assez-long-pour-signer-des-jetons';
const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT_A = uuid(10);
const TENANT_B = uuid(11);
const NORD = uuid(3);
const SUD = uuid(30);
const SITE_DE_B = uuid(33);
const BANDE_NORD = uuid(4);
const ANCIENNE_BANDE_NORD = uuid(5);
const DEUXIEME_BANDE_NORD = uuid(7);
const BANDE_DE_B = uuid(44);
const OUSMANE = uuid(51);
const AWA = uuid(52);
const LE_GERANT = uuid(54);
const GARDIEN_DE_B = uuid(61);
const TELEPHONE = uuid(91);
const PIN_HASH = '$argon2id$v=19$m=19456,t=2,p=1$dGVzdC1vbmx5LXNhbHQ$dGVzdC1vbmx5LWRpZ2VzdC1ub3QtYS1yZWFsLXBpbg';

// Words that name money: none may appear anywhere in what the caretaker's phone receives.
const MONEY = /price|amount|cost|money|currency|balance|debt|paid|payment|sale|budget|billable|unitPrice/i;

describe('Le gardien reçoit son contexte, sans argent', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let origin: string;
  // Friday November 6th, 2026, 08:00 in Dakar (UTC+0): today, yesterday, the day before = 6, 5, 4.
  const now = Date.parse('2026-11-06T08:00:00.000Z');
  const clock: Clock = { now: () => new Date(now) };

  const tokenOf = (sub: string, tenant: string, role: SessionClaims['role']) =>
    issueAccessToken({ sub, tenant, role, device: TELEPHONE }, unwrap(Instant(new Date(now).toISOString())), SECRET);
  const contextOf = async (token: string): Promise<CaretakerContext> => {
    const response = await fetch(`${origin}/api/v1/caretaker/context`, { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    return (await response.json()) as CaretakerContext;
  };
  const siteOf = (context: CaretakerContext, siteId: string): CaretakerSite => {
    const site = context.sites.find((candidate) => candidate.siteId === siteId);
    expect(site).toBeDefined();
    return site as CaretakerSite;
  };
  const ousmane = () => tokenOf(OUSMANE, TENANT_A, 'collaborator');

  // A row of the journal, written straight into the database.
  const row = (rank: number, fields: Record<string, unknown>) => ({
    tenantId: TENANT_A,
    id: uuid(rank),
    siteId: NORD,
    campaignId: BANDE_NORD,
    authorId: OUSMANE,
    deviceId: TELEPHONE,
    businessDate: new Date('2026-11-05'),
    recordedAt: new Date('2026-11-05T18:30:00.000Z'),
    type: 'Death' as const,
    fact: { quantity: 3 },
    ...fields,
  });

  beforeAll(async () => {
    db = await createTestDatabase();
    await db.superuser.tenant.createMany({ data: [TENANT_A, TENANT_B].map((id) => ({ id, name: 'Ferme', currency: 'XOF' })) });
    await db.superuser.site.createMany({
      data: [
        { id: NORD, tenantId: TENANT_A, name: 'Poulailler Nord', timeZone: 'Africa/Dakar' },
        { id: SUD, tenantId: TENANT_A, name: 'Poulailler Sud', timeZone: 'Africa/Dakar' },
        { id: SITE_DE_B, tenantId: TENANT_B, name: 'Chez B', timeZone: 'Africa/Dakar' },
      ],
    });
    const user = (id: string, tenantId: string, role: 'admin' | 'collaborator', name: string, rank: number) => ({ id, tenantId, role, name, phone: `+22177000${String(rank).padStart(4, '0')}`, pinHash: PIN_HASH });
    await db.superuser.user.createMany({
      data: [user(OUSMANE, TENANT_A, 'collaborator', 'Ousmane', 1), user(AWA, TENANT_A, 'collaborator', 'Awa', 2), user(LE_GERANT, TENANT_A, 'admin', 'Le gérant', 3), user(GARDIEN_DE_B, TENANT_B, 'collaborator', 'Gardien de B', 4)],
    });
    await db.superuser.siteAssignment.createMany({
      data: [
        { tenantId: TENANT_A, siteId: NORD, userId: OUSMANE, isPrimary: true },
        { tenantId: TENANT_A, siteId: NORD, userId: AWA, isPrimary: false },
        { tenantId: TENANT_B, siteId: SITE_DE_B, userId: GARDIEN_DE_B, isPrimary: true },
      ],
    });
    await db.superuser.campaign.createMany({
      data: [
        { id: ANCIENNE_BANDE_NORD, tenantId: TENANT_A, siteId: NORD, placementDay: new Date('2026-06-01'), closedAt: new Date('2026-07-20T10:00:00.000Z') },
        { id: BANDE_NORD, tenantId: TENANT_A, siteId: NORD, placementDay: new Date('2026-10-15') },
        // A second flock running on the same site, placed later (decision of 2026-11-07: several may run at once).
        { id: DEUXIEME_BANDE_NORD, tenantId: TENANT_A, siteId: NORD, placementDay: new Date('2026-11-01') },
        { id: BANDE_DE_B, tenantId: TENANT_B, siteId: SITE_DE_B, placementDay: new Date('2026-10-20') },
        // The Sud site only has a closed campaign: it has none running.
        { id: uuid(6), tenantId: TENANT_A, siteId: SUD, placementDay: new Date('2026-09-01'), closedAt: new Date('2026-10-20T10:00:00.000Z') },
      ],
    });
    await db.superuser.journalEvent.createMany({
      data: [
        // November 5th: 3 deaths by Ousmane, corrected to 2 by Awa; 1 bag by Awa; 4 deaths by mistake, retracted by the admin.
        row(1, {}),
        row(2, { corrects: uuid(1), authorId: AWA, recordedAt: new Date('2026-11-05T19:00:00.000Z'), fact: { quantity: 2 } }),
        row(3, { authorId: AWA, recordedAt: new Date('2026-11-05T17:00:00.000Z'), type: 'BagOpened', fact: { quantity: 1 } }),
        row(4, { recordedAt: new Date('2026-11-05T18:40:00.000Z'), fact: { quantity: 4 } }),
        row(5, { retracts: uuid(4), authorId: LE_GERANT, recordedAt: new Date('2026-11-05T20:00:00.000Z'), type: null, fact: Prisma.DbNull }),
        // November 5th: 12 chicks missing at a recount, declared by the admin — a loss, not a death.
        row(6, { authorId: LE_GERANT, recordedAt: new Date('2026-11-05T21:00:00.000Z'), type: 'Loss', fact: { lossType: 'Missing', quantity: 12 } }),
        // November 6th, this morning: nothing lost.
        row(7, { businessDate: new Date('2026-11-06'), recordedAt: new Date('2026-11-06T07:00:00.000Z'), type: 'NoLoss', fact: {} }),
        // November 3rd: older than the day before yesterday — not in the notebook's three days.
        row(8, { businessDate: new Date('2026-11-03'), recordedAt: new Date('2026-11-03T18:00:00.000Z'), fact: { quantity: 5 } }),
        // The second flock of the Nord site: 2 deaths yesterday, in its own notebook.
        row(10, { campaignId: DEUXIEME_BANDE_NORD, recordedAt: new Date('2026-11-05T18:45:00.000Z'), fact: { quantity: 2 } }),
        // The closed campaign of the same site: not today's notebook.
        row(9, { campaignId: ANCIENNE_BANDE_NORD, businessDate: new Date('2026-07-01'), recordedAt: new Date('2026-07-01T18:00:00.000Z') }),
      ],
    });
    await db.superuser.journalEvent.create({
      data: { ...row(70, {}), tenantId: TENANT_B, siteId: SITE_DE_B, campaignId: BANDE_DE_B, authorId: GARDIEN_DE_B },
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

  it("le gardien reçoit son site et chacune de ses campagnes en cours, avec son jour J — le jour de la mise en place est J0 ; une campagne clôturée n'y est pas", async () => {
    const nord = siteOf(await contextOf(ousmane()), NORD);

    expect(nord).toMatchObject({ siteId: NORD, name: 'Poulailler Nord', today: '2026-11-06' });
    expect(nord.campaigns.map(({ campaignId, placementDay, campaignDay }) => ({ campaignId, placementDay, campaignDay }))).toEqual([
      { campaignId: BANDE_NORD, placementDay: '2026-10-15', campaignDay: 22 },
      { campaignId: DEUXIEME_BANDE_NORD, placementDay: '2026-11-01', campaignDay: 5 },
    ]);
  });

  it("deux campagnes en cours sur un même site ont chacune leur journal : les déclarations de l'une ne passent pas dans l'autre (décision du 2026-11-07)", async () => {
    const [first, second] = siteOf(await contextOf(ousmane()), NORD).campaigns;

    expect(first?.journal.map((line) => line.id)).not.toContain(uuid(10));
    expect(second?.journal.map((line) => [line.id, line.fact])).toEqual([[uuid(10), { type: 'Death', quantity: 2 }]]);
  });

  it("le journal des trois derniers jours, dans l'ordre d'écriture, avec l'auteur de chaque ligne ; ni un jour plus ancien, ni une autre campagne", async () => {
    const journal = siteOf(await contextOf(ousmane()), NORD).campaigns[0]?.journal ?? [];

    expect(journal.map((line) => [line.id, line.businessDate, line.author.name])).toEqual([
      [uuid(3), '2026-11-05', 'Awa'],
      [uuid(1), '2026-11-05', 'Ousmane'],
      [uuid(4), '2026-11-05', 'Ousmane'],
      [uuid(7), '2026-11-06', 'Ousmane'],
    ]);
  });

  it("une ligne corrigée porte la valeur qui compte ; une ligne annulée est donnée comme annulée, avec ce qui avait été déclaré", async () => {
    const journal = siteOf(await contextOf(ousmane()), NORD).campaigns[0]?.journal ?? [];
    const lineOf = (rank: number) => journal.find((line) => line.id === uuid(rank));

    expect(lineOf(1)).toMatchObject({ fact: { type: 'Death', quantity: 2 }, corrected: true, retracted: false, author: { id: OUSMANE, name: 'Ousmane' } });
    expect(lineOf(4)).toMatchObject({ fact: { type: 'Death', quantity: 4 }, corrected: false, retracted: true });
    expect(lineOf(7)).toMatchObject({ fact: { type: 'NoLoss' }, corrected: false, retracted: false });
  });

  it("le gardien ne voit que les morts : une perte hors mortalité (manquants, dons) n'est pas dans son journal", async () => {
    const journal = siteOf(await contextOf(ousmane()), NORD).campaigns[0]?.journal ?? [];

    expect(journal.some((line) => line.fact.type === 'Loss')).toBe(false);
  });

  it("les vivants restent inconnus tant que les lignes de commande qui livrent les poussins ne le sont pas : absent n'est pas zéro", async () => {
    expect(siteOf(await contextOf(ousmane()), NORD).campaigns.map((campaign) => campaign.liveCount)).toEqual([null, null]);
  });

  it("sans campagne en cours — la dernière est clôturée —, la réponse le dit : une liste vide, pas de chiffres à zéro", async () => {
    const sud = siteOf(await contextOf(tokenOf(LE_GERANT, TENANT_A, 'admin')), SUD);

    expect(sud).toEqual({ siteId: SUD, name: 'Poulailler Sud', today: '2026-11-06', campaigns: [] });
  });

  it("un collaborateur ne reçoit que ses sites ; l'admin reçoit tous ceux de son élevage ; personne ne reçoit ceux d'un autre élevage", async () => {
    const ids = (context: CaretakerContext) => context.sites.map((site) => site.siteId).sort();

    expect(ids(await contextOf(ousmane()))).toEqual([NORD]);
    expect(ids(await contextOf(tokenOf(LE_GERANT, TENANT_A, 'admin')))).toEqual([NORD, SUD].sort());
    expect(ids(await contextOf(tokenOf(GARDIEN_DE_B, TENANT_B, 'collaborator')))).toEqual([SITE_DE_B]);
  });

  it("un site retiré ne descend plus, dès la requête suivante", async () => {
    // Given Awa, remplaçante du Nord, retirée du site
    expect(siteOf(await contextOf(tokenOf(AWA, TENANT_A, 'collaborator')), NORD).siteId).toBe(NORD);
    await db.superuser.siteAssignment.delete({ where: { siteId_userId: { siteId: NORD, userId: AWA } } });

    // Then
    expect((await contextOf(tokenOf(AWA, TENANT_A, 'collaborator'))).sites).toEqual([]);
  });

  it("aucun champ de la réponse ne nomme un montant, un prix, un solde ou une devise, à aucune profondeur", async () => {
    const keys = (value: unknown): string[] =>
      value !== null && typeof value === 'object' ? Object.entries(value).flatMap(([key, inner]) => [key, ...keys(inner)]) : [];

    for (const token of [ousmane(), tokenOf(LE_GERANT, TENANT_A, 'admin')]) {
      const context = await contextOf(token);
      expect(keys(context).filter((key) => MONEY.test(key))).toEqual([]);
      expect(JSON.stringify(context)).not.toMatch(/XOF/);
    }
  });

  it('sans session, la route est fermée', async () => {
    expect((await fetch(`${origin}/api/v1/caretaker/context`)).status).toBe(401);
  });
});
