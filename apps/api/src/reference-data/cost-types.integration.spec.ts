import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { unwrap, type Clock } from '@kit';
import { Instant } from '@domain/journal';
import type { CostTypeView } from '@contracts';
import { AppModule } from '../app.module';
import { issueAccessToken, type SessionClaims } from '../auth/access-token';
import { CLOCK } from '../auth/auth.module';
import { APP_CONFIG } from '../config/app-config';
import { configureApp } from '../create-app';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';

// Spec: backlog N.2 — les types propres à l'élevage ; cahier des charges « Référentiels à deux
// niveaux » (rattachés au socle, renommés sans changer d'identité, archivés jamais supprimés,
// catégorie fixe, drapeaux repris de la catégorie : décisions du 2026-11-09) ; CLAUDE.md §4
// règles 5, 6 et 14. PostgreSQL réel, HTTP.
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

describe("Les types propres à l'élevage", () => {
  let db: TestDatabase;
  let app: INestApplication;
  let origin: string;
  const now = Date.parse('2026-11-09T09:00:00.000Z');
  const clock: Clock = { now: () => new Date(now) };

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
  const cree = (body: unknown, token?: Token) => call('POST', 'cost-types', body, token);
  const regle = (id: string, body: unknown) => call('PATCH', `cost-types/${id}`, body);
  const archive = (id: string) => call('POST', `cost-types/${id}/archive`);
  const liste = async (token?: Token) => (await (await call('GET', 'cost-types', undefined, token)).json()) as CostTypeView[];
  const unType = (id: string) => async () => (await liste()).find((type) => type.id === id);
  const traceOf = (subjectId: string) =>
    db.superuser.auditEvent.findMany({ where: { subjectId }, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }], select: { action: true, actorId: true, deviceId: true, reason: true } });

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

  it("l'admin ajoute un type rattaché à une catégorie du socle : il en reprend les drapeaux ; l'ajout est tracé", async () => {
    expect((await cree({ id: uuid(101), category: 'Feed', name: 'Aliment démarrage' })).status).toBe(201);
    expect((await cree({ id: uuid(102), category: 'Labour', name: 'Gardiennage' })).status).toBe(201);

    expect(await liste()).toEqual([
      { id: uuid(101), category: 'Feed', name: 'Aliment démarrage', behaviour: 'Variable', orderable: true, archived: false },
      { id: uuid(102), category: 'Labour', name: 'Gardiennage', behaviour: 'Fixed', orderable: false, archived: false },
    ]);
    expect(await traceOf(uuid(101))).toEqual([{ action: 'CostTypeCreated', actorId: LE_GERANT, deviceId: ORDINATEUR, reason: null }]);
  });

  it('le drapeau fixe / variable peut se choisir autrement que celui de la catégorie, dès l’ajout', async () => {
    await cree({ id: uuid(103), category: 'Utilities', name: 'Abonnement eau', behaviour: 'Fixed' });

    expect(await unType(uuid(103))()).toMatchObject({ behaviour: 'Fixed', orderable: false });
  });

  it('un type sans catégorie du socle, ou avec une catégorie inconnue, est refusé (400) ; un nom vide, un champ en trop aussi — sans rien créer', async () => {
    const responses = await Promise.all([
      cree({ id: uuid(110), name: 'Sans catégorie' }),
      cree({ id: uuid(111), category: 'Fuel', name: 'Gazole' }),
      cree({ id: uuid(112), category: 'Feed', name: '  ' }),
      cree({ id: uuid(113), category: 'Feed', name: 'Aliment', tenantId: TENANT_B }),
      cree({ id: uuid(114), category: 'Feed', name: 'Aliment', orderable: false }),
      cree({ id: uuid(115), category: 'Feed', name: 'Aliment', behaviour: 'Sometimes' }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([400, 400, 400, 400, 400, 400]);
    expect(await responses[2]?.json()).toMatchObject({ kind: 'InvalidName' });
    expect(await db.superuser.costType.count({ where: { id: { in: [110, 111, 112, 113, 114, 115].map(uuid) } } })).toBe(0);
  });

  it("renommer ne change que l'étiquette : l'identifiant reste, celui que les écritures portent ; le changement est tracé", async () => {
    expect((await regle(uuid(101), { name: 'Aliment démarrage Sedima' })).status).toBe(204);
    await regle(uuid(102), { behaviour: 'Variable' });

    expect(await unType(uuid(101))()).toMatchObject({ id: uuid(101), name: 'Aliment démarrage Sedima', category: 'Feed' });
    expect(await unType(uuid(102))()).toMatchObject({ behaviour: 'Variable' });
    expect((await traceOf(uuid(101))).filter(({ action }) => action === 'CostTypeConfigured')).toEqual([
      { action: 'CostTypeConfigured', actorId: LE_GERANT, deviceId: ORDINATEUR, reason: 'name' },
    ]);
  });

  it('la catégorie d’un type ne change pas — les analyses passées en dépendent —, ni son drapeau commandable ; un corps vide non plus (400)', async () => {
    const statuses = await Promise.all([regle(uuid(101), { category: 'Health' }), regle(uuid(101), { orderable: false }), regle(uuid(101), {})]);

    expect(statuses.map((response) => response.status)).toEqual([400, 400, 400]);
    expect(await unType(uuid(101))()).toMatchObject({ category: 'Feed', orderable: true });
  });

  it("un type s'archive : il reste lisible, marqué archivé ; tracé une fois ; aucune route ni aucun droit ne le supprime", async () => {
    expect((await archive(uuid(102))).status).toBe(204);
    expect((await archive(uuid(102))).status).toBe(204);

    expect(await unType(uuid(102))()).toMatchObject({ name: 'Gardiennage', archived: true });
    expect((await traceOf(uuid(102))).filter(({ action }) => action === 'CostTypeArchived')).toHaveLength(1);
    expect((await call('DELETE', `cost-types/${uuid(103)}`)).status).toBe(404);
    const [grant] = await db.superuser.$queryRaw<{ allowed: boolean }[]>`select has_table_privilege('yaar_app', 'cost_types', 'DELETE') as allowed`;
    expect(grant?.allowed).toBe(false);
  });

  it("un identifiant pris est refusé (409) ; le type d'un autre élevage n'existe pas (404) et ne se voit pas", async () => {
    await cree({ id: uuid(201), category: 'Feed', name: 'Aliment de B' }, tokenOf(GERANT_DE_B, TENANT_B, 'admin'));

    expect((await cree({ id: uuid(101), category: 'Feed', name: 'Écrasé' })).status).toBe(409);
    expect([(await regle(uuid(201), { name: 'Volé' })).status, (await archive(uuid(201))).status]).toEqual([404, 404]);
    expect((await liste()).map(({ id }) => id)).not.toContain(uuid(201));
  });

  it('le gardien ne voit ni ne crée aucun type (403)', async () => {
    const caretaker = tokenOf(OUSMANE, TENANT_A, 'collaborator');

    expect([(await call('GET', 'cost-types', undefined, caretaker)).status, (await cree({ id: uuid(130), category: 'Feed', name: 'X' }, caretaker)).status]).toEqual([403, 403]);
  });
});
