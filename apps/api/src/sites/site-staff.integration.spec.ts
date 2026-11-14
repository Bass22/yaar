import { Controller, Get, Param, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { unwrap, type Clock } from '@kit';
import { Instant, TenantId } from '@domain/journal';
import { AppModule } from '../app.module';
import { issueAccessToken, type SessionClaims } from '../auth/access-token';
import { CLOCK } from '../auth/auth.module';
import { CurrentSession, type Session } from '../auth/session';
import { canReachSite } from '../auth/site-access';
import { APP_CONFIG } from '../config/app-config';
import { configureApp } from '../create-app';
import { PrismaService } from '../database/prisma.service';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';
import { designatePrimaryCaretaker } from './site-staff';

// Spec: Cahier des charges — « Gouvernance des déclarations » (un titulaire par site, des
// remplaçants autorisés ; décisions du 2026-11-07 : retirer le titulaire laisse le site sans
// titulaire, un nouveau titulaire fait de l'ancien un remplaçant, le premier affecté sur un
// site sans titulaire le devient) ; backlog E.7. Tourne sur un
// PostgreSQL réel, à travers le serveur HTTP.
jest.setTimeout(180_000);

const SECRET = 'un-secret-de-test-assez-long-pour-signer-des-jetons';
const TENANT_A = '00000000-0000-4000-8000-00000000000a';
const TENANT_B = '00000000-0000-4000-8000-00000000000b';
const POULAILLER_NORD = '00000000-0000-4000-8000-0000000000a1';
const POULAILLER_SUD = '00000000-0000-4000-8000-0000000000a2';
const POULAILLER_DE_B = '00000000-0000-4000-8000-0000000000b1';
const OUSMANE = '00000000-0000-4000-8000-000000000051';
const AWA = '00000000-0000-4000-8000-000000000052';
const MODOU = '00000000-0000-4000-8000-000000000053';
const LE_GERANT = '00000000-0000-4000-8000-000000000054';
const CO_GERANT = '00000000-0000-4000-8000-000000000056';
const GARDIEN_DE_B = '00000000-0000-4000-8000-0000000000b2';
const ADMIN_DE_B = '00000000-0000-4000-8000-0000000000b4';
const ORDINATEUR_DU_GERANT = '00000000-0000-4000-8000-0000000000d9';
const PIN_HASH = '$argon2id$v=19$m=19456,t=2,p=1$dGVzdC1vbmx5LXNhbHQ$dGVzdC1vbmx5LWRpZ2VzdC1ub3QtYS1yZWFsLXBpbg';

// A route written for the test: whether the caller reaches a site, as every site route will ask.
@Controller('probe')
class ProbeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('sites/:siteId')
  async reach(@CurrentSession() session: Session, @Param('siteId') siteId: string): Promise<{ reachable: boolean }> {
    return { reachable: await this.prisma.runInTenant(session.tenantId, (tx) => canReachSite(tx, session, siteId)) };
  }
}

// Polls a condition for at most five seconds.
async function until(condition: () => boolean | Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('The condition never held.');
}

describe("Affecter l'équipe aux sites", () => {
  let db: TestDatabase;
  let app: INestApplication;
  let origin: string;
  let now = Date.parse('2026-11-07T08:00:00.000Z');
  const clock: Clock = { now: () => new Date(now) };

  const tokenOf = (sub: string, tenant: string, role: SessionClaims['role']) =>
    issueAccessToken({ sub, tenant, role, device: ORDINATEUR_DU_GERANT }, unwrap(Instant(new Date(now).toISOString())), SECRET);
  const gerant = () => tokenOf(LE_GERANT, TENANT_A, 'admin');
  const request = (method: string, path: string, token: string, body?: unknown) =>
    fetch(`${origin}/api/v1/${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const assign = (siteId: string, userId: string, token = gerant()) => request('PUT', `sites/${siteId}/staff/${userId}`, token);
  const unassign = (siteId: string, userId: string, token = gerant()) => request('DELETE', `sites/${siteId}/staff/${userId}`, token);
  const designate = (siteId: string, body: unknown, token = gerant()) => request('PUT', `sites/${siteId}/primary-caretaker`, token, body);
  const staffOf = (siteId: string) =>
    db.superuser.siteAssignment.findMany({ where: { siteId }, orderBy: { userId: 'asc' }, select: { userId: true, isPrimary: true } });
  const reaches = async (userId: string, siteId: string) => {
    const response = await request('GET', `probe/sites/${siteId}`, tokenOf(userId, TENANT_A, 'collaborator'));
    expect(response.status).toBe(200);
    return ((await response.json()) as { reachable: boolean }).reachable;
  };
  const trace = () =>
    db.superuser.auditEvent.findMany({
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      select: { action: true, actorId: true, subjectId: true, siteId: true, deviceId: true, occurredAt: true },
    });
  const tick = () => {
    now += 1_000;
  };

  beforeAll(async () => {
    db = await createTestDatabase();
    await db.superuser.tenant.createMany({ data: [TENANT_A, TENANT_B].map((id) => ({ id, name: 'Ferme', currency: 'XOF' })) });
    await db.superuser.site.createMany({
      data: [
        { id: POULAILLER_NORD, tenantId: TENANT_A, name: 'Nord', timeZone: 'Africa/Dakar' },
        { id: POULAILLER_SUD, tenantId: TENANT_A, name: 'Sud', timeZone: 'Africa/Dakar' },
        { id: POULAILLER_DE_B, tenantId: TENANT_B, name: 'Chez B', timeZone: 'Africa/Dakar' },
      ],
    });
    const user = (id: string, tenantId: string, role: 'admin' | 'collaborator', rank: number) => ({ id, tenantId, role, phone: `+22177000${String(rank).padStart(4, '0')}`, name: 'Compte', pinHash: PIN_HASH });
    await db.superuser.user.createMany({
      data: [
        user(OUSMANE, TENANT_A, 'collaborator', 1),
        user(AWA, TENANT_A, 'collaborator', 2),
        user(MODOU, TENANT_A, 'collaborator', 3),
        user(LE_GERANT, TENANT_A, 'admin', 4),
        user(CO_GERANT, TENANT_A, 'admin', 5),
        user(GARDIEN_DE_B, TENANT_B, 'collaborator', 6),
        user(ADMIN_DE_B, TENANT_B, 'admin', 7),
      ],
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule], controllers: [ProbeController] })
      .overrideProvider(APP_CONFIG)
      .useValue({ port: 0, databaseUrl: db.appUrl, jwtSecret: SECRET })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.listen(0, '127.0.0.1');
    origin = await app.getUrl();
  });

  beforeEach(async () => {
    // Every test starts from a site without staff; the owner of the database clears it.
    await db.superuser.siteAssignment.deleteMany();
    tick();
  });

  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });

  describe('affecter un collaborateur à un site', () => {
    it("affecté à un site sans titulaire, un collaborateur en devient titulaire : il l'atteint dès la requête suivante, et la désignation est tracée (décision du 2026-11-07)", async () => {
      // Given un poulailler Nord sans personne, qu'Ousmane n'atteint pas
      expect(await reaches(OUSMANE, POULAILLER_NORD)).toBe(false);
      const before = (await trace()).length;

      // When le gérant l'y affecte
      const response = await assign(POULAILLER_NORD, OUSMANE);

      // Then
      expect(response.status).toBe(204);
      expect(await staffOf(POULAILLER_NORD)).toEqual([{ userId: OUSMANE, isPrimary: true }]);
      expect(await reaches(OUSMANE, POULAILLER_NORD)).toBe(true);
      expect((await trace()).slice(before)).toEqual([
        { action: 'PrimaryCaretakerDesignated', actorId: LE_GERANT, subjectId: OUSMANE, siteId: POULAILLER_NORD, deviceId: ORDINATEUR_DU_GERANT, occurredAt: new Date(now) },
      ]);
    });

    it("affecté à un site qui a un titulaire, un collaborateur y est remplaçant, et l'affectation est tracée", async () => {
      // Given Ousmane titulaire du Nord
      await assign(POULAILLER_NORD, OUSMANE);
      tick();
      const before = (await trace()).length;

      // When le gérant y affecte Awa
      const response = await assign(POULAILLER_NORD, AWA);

      // Then
      expect(response.status).toBe(204);
      expect(await staffOf(POULAILLER_NORD)).toEqual([
        { userId: OUSMANE, isPrimary: true },
        { userId: AWA, isPrimary: false },
      ]);
      expect(await reaches(AWA, POULAILLER_NORD)).toBe(true);
      expect((await trace()).slice(before)).toEqual([
        { action: 'SiteAssigned', actorId: LE_GERANT, subjectId: AWA, siteId: POULAILLER_NORD, deviceId: ORDINATEUR_DU_GERANT, occurredAt: new Date(now) },
      ]);
    });

    it("un collaborateur s'affecte à plusieurs sites, et n'atteint que ceux-là", async () => {
      expect((await assign(POULAILLER_NORD, OUSMANE)).status).toBe(204);
      expect((await assign(POULAILLER_SUD, OUSMANE)).status).toBe(204);

      expect(await reaches(OUSMANE, POULAILLER_NORD)).toBe(true);
      expect(await reaches(OUSMANE, POULAILLER_SUD)).toBe(true);
      expect(await reaches(AWA, POULAILLER_NORD)).toBe(false);
    });

    it("affecter de nouveau un collaborateur déjà affecté ne change rien : le titulaire le reste, et rien n'est tracé", async () => {
      // Given Ousmane titulaire du Nord
      expect((await designate(POULAILLER_NORD, { userId: OUSMANE })).status).toBe(204);
      const before = (await trace()).length;

      // When le gérant l'y affecte de nouveau
      const response = await assign(POULAILLER_NORD, OUSMANE);

      // Then il reste titulaire
      expect(response.status).toBe(204);
      expect(await staffOf(POULAILLER_NORD)).toEqual([{ userId: OUSMANE, isPrimary: true }]);
      expect((await trace()).length).toBe(before);
    });
  });

  describe('retirer une affectation', () => {
    it("l'admin retire un remplaçant : il n'atteint plus le site dès la requête suivante, et le retrait est tracé", async () => {
      // Given Ousmane titulaire, Awa remplaçante
      await designate(POULAILLER_NORD, { userId: OUSMANE });
      await assign(POULAILLER_NORD, AWA);
      expect(await reaches(AWA, POULAILLER_NORD)).toBe(true);
      tick();
      const before = (await trace()).length;

      // When le gérant retire Awa
      const response = await unassign(POULAILLER_NORD, AWA);

      // Then
      expect(response.status).toBe(204);
      expect(await reaches(AWA, POULAILLER_NORD)).toBe(false);
      expect(await staffOf(POULAILLER_NORD)).toEqual([{ userId: OUSMANE, isPrimary: true }]);
      expect((await trace()).slice(before)).toEqual([
        { action: 'SiteUnassigned', actorId: LE_GERANT, subjectId: AWA, siteId: POULAILLER_NORD, deviceId: ORDINATEUR_DU_GERANT, occurredAt: new Date(now) },
      ]);
    });

    it("retirer le titulaire laisse le site sans titulaire : ses remplaçants restent remplaçants, personne n'est promu (décision du 2026-11-07)", async () => {
      // Given Ousmane titulaire, Awa remplaçante
      await designate(POULAILLER_NORD, { userId: OUSMANE });
      await assign(POULAILLER_NORD, AWA);

      // When le gérant retire Ousmane (parti, ou téléphone volé)
      const response = await unassign(POULAILLER_NORD, OUSMANE);

      // Then
      expect(response.status).toBe(204);
      expect(await staffOf(POULAILLER_NORD)).toEqual([{ userId: AWA, isPrimary: false }]);
      expect(await reaches(OUSMANE, POULAILLER_NORD)).toBe(false);
    });

    it("un site resté sans titulaire : le prochain collaborateur affecté en devient titulaire", async () => {
      // Given Ousmane titulaire et Awa remplaçante, puis Ousmane retiré
      await assign(POULAILLER_NORD, OUSMANE);
      await assign(POULAILLER_NORD, AWA);
      await unassign(POULAILLER_NORD, OUSMANE);

      // When le gérant affecte Modou
      expect((await assign(POULAILLER_NORD, MODOU)).status).toBe(204);

      // Then Modou est titulaire, Awa reste remplaçante
      expect(await staffOf(POULAILLER_NORD)).toEqual([
        { userId: AWA, isPrimary: false },
        { userId: MODOU, isPrimary: true },
      ]);
    });

    it("retirer une affectation sur un site n'enlève pas les autres sites du collaborateur", async () => {
      await assign(POULAILLER_NORD, OUSMANE);
      await assign(POULAILLER_SUD, OUSMANE);

      expect((await unassign(POULAILLER_NORD, OUSMANE)).status).toBe(204);

      expect(await reaches(OUSMANE, POULAILLER_NORD)).toBe(false);
      expect(await reaches(OUSMANE, POULAILLER_SUD)).toBe(true);
    });

    it("retirer un collaborateur qui n'est pas affecté au site répond 404 et ne trace rien", async () => {
      const before = (await trace()).length;

      expect((await unassign(POULAILLER_NORD, OUSMANE)).status).toBe(404);
      expect((await trace()).length).toBe(before);
    });
  });

  describe('désigner le titulaire', () => {
    it("l'admin désigne le titulaire d'un site où le collaborateur n'est pas encore : il y est affecté et titulaire, d'un seul geste tracé", async () => {
      const before = (await trace()).length;

      const response = await designate(POULAILLER_NORD, { userId: OUSMANE });

      expect(response.status).toBe(204);
      expect(await staffOf(POULAILLER_NORD)).toEqual([{ userId: OUSMANE, isPrimary: true }]);
      expect(await reaches(OUSMANE, POULAILLER_NORD)).toBe(true);
      expect((await trace()).slice(before)).toEqual([
        { action: 'PrimaryCaretakerDesignated', actorId: LE_GERANT, subjectId: OUSMANE, siteId: POULAILLER_NORD, deviceId: ORDINATEUR_DU_GERANT, occurredAt: new Date(now) },
      ]);
    });

    it("désigner un remplaçant comme titulaire fait de l'ancien titulaire un remplaçant : un site n'a qu'un titulaire, et personne ne perd l'accès (décision du 2026-11-07)", async () => {
      // Given Ousmane titulaire, Awa remplaçante
      await designate(POULAILLER_NORD, { userId: OUSMANE });
      await assign(POULAILLER_NORD, AWA);

      // When le gérant désigne Awa
      const response = await designate(POULAILLER_NORD, { userId: AWA });

      // Then
      expect(response.status).toBe(204);
      expect(await staffOf(POULAILLER_NORD)).toEqual([
        { userId: OUSMANE, isPrimary: false },
        { userId: AWA, isPrimary: true },
      ]);
      expect(await reaches(OUSMANE, POULAILLER_NORD)).toBe(true);
    });

    it("désigner le titulaire en place ne change rien et ne trace rien", async () => {
      await designate(POULAILLER_NORD, { userId: OUSMANE });
      const before = (await trace()).length;

      expect((await designate(POULAILLER_NORD, { userId: OUSMANE })).status).toBe(204);

      expect(await staffOf(POULAILLER_NORD)).toEqual([{ userId: OUSMANE, isPrimary: true }]);
      expect((await trace()).length).toBe(before);
    });

    it("être titulaire d'un site ne donne rien sur un autre site", async () => {
      await designate(POULAILLER_NORD, { userId: OUSMANE });
      await designate(POULAILLER_SUD, { userId: AWA });

      expect(await staffOf(POULAILLER_NORD)).toEqual([{ userId: OUSMANE, isPrimary: true }]);
      expect(await staffOf(POULAILLER_SUD)).toEqual([{ userId: AWA, isPrimary: true }]);
      expect(await reaches(OUSMANE, POULAILLER_SUD)).toBe(false);
    });

    it("deux admins qui désignent chacun un titulaire au même moment sont servis l'un après l'autre : un seul titulaire, aucune erreur, le dernier servi l'emporte", async () => {
      // Given Ousmane titulaire
      await designate(POULAILLER_NORD, { userId: OUSMANE });
      const api = new PrismaService({ port: 0, databaseUrl: db.appUrl, jwtSecret: SECRET, mediaPath: '/data/medias', vapidPublicKey: null });
      const tenant = unwrap(TenantId(TENANT_A));
      const admin = (userId: string): Session => ({ userId, tenantId: tenant, role: 'admin', deviceId: ORDINATEUR_DU_GERANT });
      let release = () => undefined as void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let firstWritten = false;
      try {
        // When le gérant désigne Awa, et sa transaction reste ouverte après l'écriture
        const first = api.runInTenant(tenant, async (tx) => {
          const result = await designatePrimaryCaretaker(tx, admin(LE_GERANT), POULAILLER_NORD, AWA, new Date(now));
          firstWritten = true;
          await held;
          return result;
        });
        await until(() => firstWritten);
        // And le co-gérant désigne Modou pendant ce temps : sa transaction attend
        const second = api.runInTenant(tenant, (tx) => designatePrimaryCaretaker(tx, admin(CO_GERANT), POULAILLER_NORD, MODOU, new Date(now)));
        await until(async () => (await db.superuser.$queryRaw<{ waiting: number }[]>`SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE wait_event_type = 'Lock'`)[0]?.waiting === 1);
        release();

        // Then les deux réussissent, Modou est titulaire, Ousmane et Awa restent remplaçants
        expect(await first).toEqual({ ok: true, value: undefined });
        expect(await second).toEqual({ ok: true, value: undefined });
        expect(await staffOf(POULAILLER_NORD)).toEqual([
          { userId: OUSMANE, isPrimary: false },
          { userId: AWA, isPrimary: false },
          { userId: MODOU, isPrimary: true },
        ]);
      } finally {
        release();
        await api.$disconnect();
      }
    });

    it("le corps porte exactement l'identifiant du titulaire : un champ de plus, de moins ou d'un autre type est refusé en 400", async () => {
      for (const body of [{}, { userId: OUSMANE, isPrimary: false }, { userId: 51 }, [OUSMANE], { userId: OUSMANE, tenantId: TENANT_B }]) {
        expect((await designate(POULAILLER_NORD, body)).status).toBe(400);
      }
      expect(await staffOf(POULAILLER_NORD)).toEqual([]);
    });
  });

  describe('qui peut affecter, et qui', () => {
    it("un collaborateur ne s'affecte pas lui-même, ne se désigne pas titulaire, ne retire personne : 403, et rien ne change", async () => {
      await designate(POULAILLER_SUD, { userId: AWA });
      const ousmane = tokenOf(OUSMANE, TENANT_A, 'collaborator');
      const before = (await trace()).length;

      expect((await assign(POULAILLER_NORD, OUSMANE, ousmane)).status).toBe(403);
      expect((await designate(POULAILLER_NORD, { userId: OUSMANE }, ousmane)).status).toBe(403);
      expect((await unassign(POULAILLER_SUD, AWA, ousmane)).status).toBe(403);

      expect(await staffOf(POULAILLER_NORD)).toEqual([]);
      expect(await staffOf(POULAILLER_SUD)).toEqual([{ userId: AWA, isPrimary: true }]);
      expect((await trace()).length).toBe(before);
    });

    it("un admin ne s'affecte pas à un site : il les atteint déjà tous ; ni lui, ni un autre admin ne sont affectés ou désignés (403)", async () => {
      for (const admin of [LE_GERANT, CO_GERANT]) {
        expect((await assign(POULAILLER_NORD, admin)).status).toBe(403);
        expect((await designate(POULAILLER_NORD, { userId: admin })).status).toBe(403);
      }
      expect(await staffOf(POULAILLER_NORD)).toEqual([]);
    });

    it("un site ou un compte d'un autre élevage n'existe pas pour l'admin : 404, et rien ne change chez personne", async () => {
      // Given le gardien de B affecté chez B
      await db.superuser.siteAssignment.create({ data: { tenantId: TENANT_B, siteId: POULAILLER_DE_B, userId: GARDIEN_DE_B, isPrimary: true } });
      const before = (await trace()).length;

      expect((await assign(POULAILLER_DE_B, OUSMANE)).status).toBe(404);
      expect((await assign(POULAILLER_NORD, GARDIEN_DE_B)).status).toBe(404);
      expect((await designate(POULAILLER_NORD, { userId: GARDIEN_DE_B })).status).toBe(404);
      expect((await designate(POULAILLER_DE_B, { userId: OUSMANE })).status).toBe(404);
      expect((await unassign(POULAILLER_DE_B, GARDIEN_DE_B)).status).toBe(404);
      // The admin of B cannot reach A either.
      expect((await assign(POULAILLER_NORD, OUSMANE, tokenOf(ADMIN_DE_B, TENANT_B, 'admin'))).status).toBe(404);

      expect(await staffOf(POULAILLER_NORD)).toEqual([]);
      expect(await staffOf(POULAILLER_DE_B)).toEqual([{ userId: GARDIEN_DE_B, isPrimary: true }]);
      expect((await trace()).length).toBe(before);
    });

    it("un identifiant de site ou de compte qui n'est pas un UUID répond 404", async () => {
      expect((await assign('nord', OUSMANE)).status).toBe(404);
      expect((await assign(POULAILLER_NORD, 'ousmane')).status).toBe(404);
      expect((await unassign(POULAILLER_NORD, 'ousmane')).status).toBe(404);
      expect((await designate('nord', { userId: OUSMANE })).status).toBe(404);
      expect((await designate(POULAILLER_NORD, { userId: 'ousmane' })).status).toBe(404);
    });
  });
});
