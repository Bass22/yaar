import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { unwrap, type Clock } from '@kit';
import { Instant } from '@domain/journal';
import { AppModule } from '../app.module';
import { issueAccessToken, type SessionClaims } from '../auth/access-token';
import { CLOCK } from '../auth/auth.module';
import { APP_CONFIG } from '../config/app-config';
import { configureApp } from '../create-app';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';

// Spec: backlog O.1 — configurer un site ; cahier des charges « Onboarding assisté »
// (configuration du site), « Mode strict optionnel par site — un choix de l'admin » ; E.9 (la
// voix suit la personne, sinon son site) ; CLAUDE.md §4 règles 5, 6 et 14. PostgreSQL réel, HTTP.
jest.setTimeout(180_000);

const SECRET = 'un-secret-de-test-assez-long-pour-signer-des-jetons';
const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT_A = uuid(10);
const TENANT_B = uuid(11);
const NORD = uuid(3);
const SITE_DE_B = uuid(33);
const OUSMANE = uuid(51);
const LE_GERANT = uuid(54);
const ORDINATEUR = uuid(92);
const PIN_HASH = '$argon2id$v=19$m=19456,t=2,p=1$dGVzdC1vbmx5LXNhbHQ$dGVzdC1vbmx5LWRpZ2VzdC1ub3QtYS1yZWFsLXBpbg';

describe('Configurer un site', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let origin: string;
  const now = Date.parse('2026-11-08T09:00:00.000Z');
  const clock: Clock = { now: () => new Date(now) };

  const tokenOf = (sub: string, tenant: string, role: SessionClaims['role']) =>
    issueAccessToken({ sub, tenant, role, device: ORDINATEUR }, unwrap(Instant(new Date(now).toISOString())), SECRET);
  const gerant = () => tokenOf(LE_GERANT, TENANT_A, 'admin');
  const request = (method: string, path: string, body: unknown, token = gerant()) =>
    fetch(`${origin}/api/v1/${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const create = (body: unknown, token?: ReturnType<typeof gerant>) => request('POST', 'sites', body, token);
  const configure = (siteId: string, body: unknown, token?: ReturnType<typeof gerant>) => request('PATCH', `sites/${siteId}`, body, token);
  const siteRow = (id: string) => db.superuser.site.findUnique({ where: { id }, select: { tenantId: true, name: true, timeZone: true, strictMode: true, audioLanguage: true } });
  const traceOf = (siteId: string) =>
    db.superuser.auditEvent.findMany({ where: { siteId }, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }], select: { action: true, actorId: true, subjectId: true, deviceId: true, reason: true } });

  beforeAll(async () => {
    db = await createTestDatabase();
    await db.superuser.tenant.createMany({ data: [TENANT_A, TENANT_B].map((id) => ({ id, name: 'Ferme', currency: 'XOF' })) });
    await db.superuser.site.createMany({
      data: [
        { id: NORD, tenantId: TENANT_A, name: 'Poulailler Nord', timeZone: 'Africa/Dakar' },
        { id: SITE_DE_B, tenantId: TENANT_B, name: 'Chez B', timeZone: 'Africa/Dakar' },
      ],
    });
    await db.superuser.user.createMany({
      data: [
        { id: OUSMANE, tenantId: TENANT_A, role: 'collaborator', phone: '+221770000001', name: 'Ousmane', pinHash: PIN_HASH },
        { id: LE_GERANT, tenantId: TENANT_A, role: 'admin', phone: '+221770000002', name: 'Le gérant', pinHash: PIN_HASH },
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

  describe('créer un site', () => {
    it("l'admin crée un site dans son élevage : le mode strict est désactivé, la voix suit chaque personne ; la création est tracée", async () => {
      const response = await create({ id: uuid(101), name: 'Poulailler Est', timeZone: 'Africa/Dakar' });

      expect(response.status).toBe(201);
      expect(await siteRow(uuid(101))).toEqual({ tenantId: TENANT_A, name: 'Poulailler Est', timeZone: 'Africa/Dakar', strictMode: false, audioLanguage: null });
      expect(await traceOf(uuid(101))).toEqual([{ action: 'SiteCreated', actorId: LE_GERANT, subjectId: uuid(101), deviceId: ORDINATEUR, reason: null }]);
    });

    it('il peut choisir la voix par défaut du site dès sa création', async () => {
      expect((await create({ id: uuid(102), name: 'Poulailler Ouest', timeZone: 'Africa/Dakar', audioLanguage: 'wo' })).status).toBe(201);

      expect((await siteRow(uuid(102)))?.audioLanguage).toBe('wo');
    });

    it("un fuseau inconnu, un nom vide ou un champ en trop sont refusés (400), sans rien créer — l'élevage vient de la session, jamais du corps", async () => {
      const fuseau = await create({ id: uuid(103), name: 'Est', timeZone: 'Afrique/Nulle-part' });
      const nom = await create({ id: uuid(104), name: '   ', timeZone: 'Africa/Dakar' });
      const enTrop = await create({ id: uuid(105), name: 'Est', timeZone: 'Africa/Dakar', tenantId: TENANT_B });
      const strict = await create({ id: uuid(106), name: 'Est', timeZone: 'Africa/Dakar', strictMode: true });

      expect([fuseau.status, nom.status, enTrop.status, strict.status]).toEqual([400, 400, 400, 400]);
      expect(await fuseau.json()).toMatchObject({ kind: 'InvalidTimeZone' });
      expect(await nom.json()).toMatchObject({ kind: 'InvalidName' });
      expect(await db.superuser.site.count({ where: { id: { in: [uuid(103), uuid(104), uuid(105), uuid(106)] } } })).toBe(0);
    });

    it("un identifiant déjà pris est refusé (409), le site existant n'est pas touché", async () => {
      const response = await create({ id: NORD, name: 'Écrasé', timeZone: 'Africa/Dakar' });

      expect(response.status).toBe(409);
      expect((await siteRow(NORD))?.name).toBe('Poulailler Nord');
    });

    it('un collaborateur ne crée pas de site (403)', async () => {
      expect((await create({ id: uuid(107), name: 'Est', timeZone: 'Africa/Dakar' }, tokenOf(OUSMANE, TENANT_A, 'collaborator'))).status).toBe(403);
    });
  });

  describe('régler un site', () => {
    it("l'admin active le mode strict, puis le désactive : chaque changement est tracé, avec ce qui a changé", async () => {
      expect((await configure(NORD, { strictMode: true })).status).toBe(204);
      expect((await siteRow(NORD))?.strictMode).toBe(true);
      await configure(NORD, { strictMode: false });

      expect((await siteRow(NORD))?.strictMode).toBe(false);
      expect((await traceOf(NORD)).filter((row) => row.action === 'SiteConfigured')).toEqual([
        { action: 'SiteConfigured', actorId: LE_GERANT, subjectId: NORD, deviceId: ORDINATEUR, reason: 'strictMode' },
        { action: 'SiteConfigured', actorId: LE_GERANT, subjectId: NORD, deviceId: ORDINATEUR, reason: 'strictMode' },
      ]);
    });

    it('il choisit la voix par défaut du site, ou la retire ; il renomme le site', async () => {
      await configure(NORD, { audioLanguage: 'fr', name: 'Nord' });
      expect(await siteRow(NORD)).toMatchObject({ audioLanguage: 'fr', name: 'Nord' });

      await configure(NORD, { audioLanguage: null });
      expect((await siteRow(NORD))?.audioLanguage).toBeNull();
    });

    it("un réglage qui ne change rien ne laisse pas de trace", async () => {
      await configure(NORD, { strictMode: false });
      const before = (await traceOf(NORD)).length;

      expect((await configure(NORD, { strictMode: false })).status).toBe(204);
      expect(await traceOf(NORD)).toHaveLength(before);
    });

    it("le fuseau ne se change pas — il dit quel jour métier est chaque instant du journal —, ni l'élevage ; un corps vide non plus (400)", async () => {
      const statuses = await Promise.all([configure(NORD, { timeZone: 'Europe/Paris' }), configure(NORD, { tenantId: TENANT_B }), configure(NORD, {}), configure(NORD, { strictMode: 'oui' })]);

      expect(statuses.map((response) => response.status)).toEqual([400, 400, 400, 400]);
      expect((await siteRow(NORD))?.timeZone).toBe('Africa/Dakar');
    });

    it("le site d'un autre élevage n'existe pas (404) ; un collaborateur ne règle rien (403)", async () => {
      expect((await configure(SITE_DE_B, { strictMode: true })).status).toBe(404);
      expect((await siteRow(SITE_DE_B))?.strictMode).toBe(false);
      expect((await configure(NORD, { strictMode: true }, tokenOf(OUSMANE, TENANT_A, 'collaborator'))).status).toBe(403);
    });
  });
});
