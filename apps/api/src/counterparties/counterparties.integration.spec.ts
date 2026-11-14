import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { unwrap, type Clock } from '@kit';
import { Instant } from '@domain/journal';
import type { CounterpartyView } from '@contracts';
import { AppModule } from '../app.module';
import { issueAccessToken, type SessionClaims } from '../auth/access-token';
import { CLOCK } from '../auth/auth.module';
import { APP_CONFIG } from '../config/app-config';
import { configureApp } from '../create-app';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';

// Spec: backlog N.3 — les tiers ; cahier des charges « Qui doit quoi » (le tiers : décisions du
// 2026-11-09 — trois sortes qui ne changent plus, un picto pour visage, archivé jamais supprimé) ;
// CLAUDE.md §4 règles 4, 5, 6 et 14. PostgreSQL réel, HTTP.
jest.setTimeout(180_000);

const SECRET = 'un-secret-de-test-assez-long-pour-signer-des-jetons';
const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT_A = uuid(10);
const TENANT_B = uuid(11);
const OUSMANE = uuid(51);
const LE_GERANT = uuid(54);
const GERANT_DE_B = uuid(55);
const ORDINATEUR = uuid(92);
const PIN_HASH = '$argon2id$v=19$m=19456,t=2,p=1$dGVzdC1vbmx5LXNhbHQ$dGVzdC1vbmx5LWRpZ2VzdC1ub3QtYS1yZWFsLXBpbg';

describe('Les tiers', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let origin: string;
  const now = Date.parse('2026-11-09T09:00:00.000Z');
  const clock: Clock = { now: () => new Date(now) };

  const tokenOf = (sub: string, tenant: string, role: SessionClaims['role']) =>
    issueAccessToken({ sub, tenant, role, device: ORDINATEUR }, unwrap(Instant(new Date(now - 60_000).toISOString())), SECRET);
  const gerant = () => tokenOf(LE_GERANT, TENANT_A, 'admin');
  const call = (method: string, path: string, body?: unknown, token = gerant()) =>
    fetch(`${origin}/api/v1/${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const cree = (body: unknown, token?: ReturnType<typeof gerant>) => call('POST', 'counterparties', body, token);
  const regle = (id: string, body: unknown) => call('PATCH', `counterparties/${id}`, body);
  const archive = (id: string) => call('POST', `counterparties/${id}/archive`);
  const liste = async (token?: ReturnType<typeof gerant>) => (await (await call('GET', 'counterparties', undefined, token)).json()) as CounterpartyView[];
  const traceOf = (subjectId: string) =>
    db.superuser.auditEvent.findMany({ where: { subjectId }, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }], select: { action: true, actorId: true, deviceId: true, reason: true, siteId: true } });
  const unFournisseur = (rank: number, fields: Record<string, unknown> = {}) => ({ id: uuid(rank), kind: 'Supplier', name: 'Sedima', face: 'closed-bag', ...fields });

  beforeAll(async () => {
    db = await createTestDatabase();
    await db.superuser.tenant.createMany({ data: [TENANT_A, TENANT_B].map((id) => ({ id, name: 'Ferme', currency: 'XOF' })) });
    await db.superuser.user.createMany({
      data: [
        { id: OUSMANE, tenantId: TENANT_A, role: 'collaborator', phone: '+221770000001', name: 'Ousmane', pinHash: PIN_HASH },
        { id: LE_GERANT, tenantId: TENANT_A, role: 'admin', phone: '+221770000002', name: 'Le gérant', pinHash: PIN_HASH },
        { id: GERANT_DE_B, tenantId: TENANT_B, role: 'admin', phone: '+221770000003', name: 'Gérant B', pinHash: PIN_HASH },
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

  it("l'admin crée un fournisseur, un client et un collaborateur, chacun avec son visage ; chaque création est tracée", async () => {
    const statuses = await Promise.all([
      cree(unFournisseur(101)),
      cree({ id: uuid(102), kind: 'Customer', name: 'Ramasseur Fall', face: 'hen' }),
      // Abdou peut avancer des frais pour l'élevage (R.7)
      cree({ id: uuid(103), kind: 'Collaborator', name: 'Abdou', face: 'caretaker', advancesExpenses: true }),
    ]);

    expect(statuses.map((response) => response.status)).toEqual([201, 201, 201]);
    expect(await traceOf(uuid(101))).toEqual([{ action: 'CounterpartyCreated', actorId: LE_GERANT, deviceId: ORDINATEUR, reason: null, siteId: null }]);
  });

  it("le bureau lit les tiers de son élevage, par ordre de nom, sans ceux d'un autre élevage", async () => {
    await cree({ id: uuid(201), kind: 'Supplier', name: 'Fournisseur de B', face: 'truck' }, tokenOf(GERANT_DE_B, TENANT_B, 'admin'));

    expect(await liste()).toEqual([
      // Seul Abdou avance des frais : sans rien dire à la création, personne d'autre (R.7)
      { id: uuid(103), kind: 'Collaborator', name: 'Abdou', face: 'caretaker', advancesExpenses: true, archived: false },
      { id: uuid(102), kind: 'Customer', name: 'Ramasseur Fall', face: 'hen', advancesExpenses: false, archived: false },
      { id: uuid(101), kind: 'Supplier', name: 'Sedima', face: 'closed-bag', advancesExpenses: false, archived: false },
    ]);
  });

  it('une sorte ou un visage hors liste, un nom vide ou trop long, un champ en trop sont refusés (400), sans rien créer — l’élevage vient de la session', async () => {
    const responses = await Promise.all([
      cree(unFournisseur(110, { kind: 'Banker' })),
      cree(unFournisseur(111, { face: 'avatar-baobab' })),
      cree(unFournisseur(112, { name: '   ' })),
      cree(unFournisseur(113, { name: 'x'.repeat(61) })),
      cree(unFournisseur(114, { tenantId: TENANT_B })),
      cree(unFournisseur(115, { id: 'pas-un-uuid' })),
    ]);

    expect(responses.map((response) => response.status)).toEqual([400, 400, 400, 400, 400, 400]);
    expect(await responses[2]?.json()).toMatchObject({ kind: 'InvalidName' });
    expect(await db.superuser.counterparty.count({ where: { id: { in: [110, 111, 112, 113, 114].map(uuid) } } })).toBe(0);
  });

  // Refactoring du 2026-11-14 : une liste est refusée par la forme du corps (`objectOf`), et sans elle par la liste blanche des champs
  it('un corps qui est une liste, et non un objet, est refusé (400), à la création comme au réglage', async () => {
    const responses = await Promise.all([cree([unFournisseur(117)]), regle(uuid(101), [{ name: 'Sedima' }])]);

    expect(responses.map((response) => response.status)).toEqual([400, 400]);
    expect(await Promise.all(responses.map(async (response) => ((await response.json()) as { kind: string }).kind))).toEqual(['InvalidRequest', 'InvalidRequest']);
    expect(await db.superuser.counterparty.count({ where: { id: uuid(117) } })).toBe(0);
  });

  it('un nom se nettoie de ses espaces autour', async () => {
    await cree(unFournisseur(120, { name: '  Sénégal Aliment  ' }));

    expect((await liste()).find(({ id }) => id === uuid(120))?.name).toBe('Sénégal Aliment');
  });

  it("un identifiant déjà pris est refusé (409), le tiers existant n'est pas touché", async () => {
    expect((await cree(unFournisseur(101, { name: 'Écrasé' }))).status).toBe(409);
    expect((await liste()).find(({ id }) => id === uuid(101))?.name).toBe('Sedima');
  });

  it("l'admin change le nom et le visage d'un tiers ; le changement est tracé avec ce qui a changé ; un réglage qui ne change rien ne laisse pas de trace", async () => {
    expect((await regle(uuid(101), { name: 'Sedima Thiès', face: 'truck' })).status).toBe(204);
    expect((await regle(uuid(101), { name: 'Sedima Thiès' })).status).toBe(204);

    expect((await liste()).find(({ id }) => id === uuid(101))).toMatchObject({ name: 'Sedima Thiès', face: 'truck' });
    expect((await traceOf(uuid(101))).filter(({ action }) => action === 'CounterpartyConfigured')).toEqual([
      { action: 'CounterpartyConfigured', actorId: LE_GERANT, deviceId: ORDINATEUR, reason: 'face,name', siteId: null },
    ]);
  });

  // Spec: backlog R.7 — « peut avancer des frais » (demande du fondateur du 2026-11-13)
  it('l’admin coche ou décoche « peut avancer des frais » ; c’est tracé ; une valeur qui n’est pas oui ou non est refusée (400)', async () => {
    expect((await regle(uuid(102), { advancesExpenses: true })).status).toBe(204);
    expect((await liste()).find(({ id }) => id === uuid(102))?.advancesExpenses).toBe(true);
    expect((await traceOf(uuid(102))).filter(({ action }) => action === 'CounterpartyConfigured')).toEqual([
      { action: 'CounterpartyConfigured', actorId: LE_GERANT, deviceId: ORDINATEUR, reason: 'advancesExpenses', siteId: null },
    ]);
    expect([(await regle(uuid(102), { advancesExpenses: 'oui' })).status, (await cree({ ...unFournisseur(104), advancesExpenses: 1 })).status]).toEqual([400, 400]);
  });

  it("la sorte d'un tiers ne change pas — elle dit de quel côté du grand livre il est —, ni son élevage ; un corps vide non plus (400)", async () => {
    const statuses = await Promise.all([regle(uuid(101), { kind: 'Customer' }), regle(uuid(101), { tenantId: TENANT_B }), regle(uuid(101), {}), regle(uuid(101), { face: 'moon' })]);

    expect(statuses.map((response) => response.status)).toEqual([400, 400, 400, 400]);
    expect((await liste()).find(({ id }) => id === uuid(101))?.kind).toBe('Supplier');
  });

  it("un tiers s'archive : il reste lisible, marqué archivé ; l'archivage est tracé une fois, même demandé deux fois", async () => {
    expect((await archive(uuid(102))).status).toBe(204);
    expect((await archive(uuid(102))).status).toBe(204);

    expect((await liste()).find(({ id }) => id === uuid(102))).toMatchObject({ name: 'Ramasseur Fall', archived: true });
    expect((await traceOf(uuid(102))).filter(({ action }) => action === 'CounterpartyArchived')).toHaveLength(1);
  });

  it("aucune route ne supprime un tiers, et la base ne le permet pas à l'application", async () => {
    expect((await call('DELETE', `counterparties/${uuid(103)}`)).status).toBe(404);
    const [grant] = await db.superuser.$queryRaw<{ allowed: boolean }[]>`select has_table_privilege('yaar_app', 'counterparties', 'DELETE') as allowed`;
    expect(grant?.allowed).toBe(false);
  });

  it("le tiers d'un autre élevage n'existe pas (404), ni pour le régler ni pour l'archiver", async () => {
    expect([(await regle(uuid(201), { name: 'Volé' })).status, (await archive(uuid(201))).status]).toEqual([404, 404]);
  });

  it('le gardien ne voit ni ne crée aucun tiers (403)', async () => {
    const caretaker = tokenOf(OUSMANE, TENANT_A, 'collaborator');

    expect([(await call('GET', 'counterparties', undefined, caretaker)).status, (await cree(unFournisseur(130), caretaker)).status]).toEqual([403, 403]);
  });
});
