import { Controller, Get, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { unwrap, type Clock } from '@kit';
import { Instant } from '@domain/journal';
import { AppModule } from '../app.module';
import { issueAccessToken, type SessionClaims } from '../auth/access-token';
import { CLOCK } from '../auth/auth.module';
import { APP_CONFIG } from '../config/app-config';
import { configureApp } from '../create-app';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';

// Spec: Cahier des charges — « Identité » (téléphone volé : l'admin bloque le compte, ce qui
// déconnecte tous ses appareils ; débloquer ou « déconnecter partout » invalident les jetons
// émis avant) ; backlog E.4. Tourne sur un PostgreSQL réel, à travers le serveur HTTP.
jest.setTimeout(180_000);

const SECRET = 'un-secret-de-test-assez-long-pour-signer-des-jetons';
const TENANT_A = '00000000-0000-4000-8000-00000000000a';
const TENANT_B = '00000000-0000-4000-8000-00000000000b';
const OUSMANE = '00000000-0000-4000-8000-000000000051';
const AWA = '00000000-0000-4000-8000-000000000052';
const LE_GERANT = '00000000-0000-4000-8000-000000000054';
const CO_GERANT = '00000000-0000-4000-8000-000000000056';
const GARDIEN_DE_B = '00000000-0000-4000-8000-0000000000b2';
const ADMIN_DE_B = '00000000-0000-4000-8000-0000000000b4';
const TELEPHONE = '00000000-0000-4000-8000-0000000000d1';
const SECOND_TELEPHONE = '00000000-0000-4000-8000-0000000000d2';
const PIN_HASH = '$argon2id$v=19$m=19456,t=2,p=1$dGVzdC1vbmx5LXNhbHQ$dGVzdC1vbmx5LWRpZ2VzdC1ub3QtYS1yZWFsLXBpbg';

// A route written for the test, without @Public(): it answers 200 to any standing session.
@Controller('probe')
class ProbeController {
  @Get()
  ping(): { ok: true } {
    return { ok: true };
  }
}

describe("Bloquer un compte, le déconnecter partout", () => {
  let db: TestDatabase;
  let app: INestApplication;
  let origin: string;
  let now = Date.parse('2026-11-07T08:00:00.000Z');
  const clock: Clock = { now: () => new Date(now) };
  const at = (iso: string) => {
    now = Date.parse(iso);
  };

  const tokenOf = (sub: string, tenant: string, role: SessionClaims['role'], device = TELEPHONE) =>
    issueAccessToken({ sub, tenant, role, device }, unwrap(Instant(new Date(now).toISOString())), SECRET);
  const gerant = () => tokenOf(LE_GERANT, TENANT_A, 'admin');
  const act = (action: 'block' | 'unblock' | 'sign-out-everywhere', userId: string, token = gerant()) =>
    fetch(`${origin}/api/v1/users/${userId}/${action}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  const sessionWorks = async (token: string) => {
    const status = (await fetch(`${origin}/api/v1/probe`, { headers: { Authorization: `Bearer ${token}` } })).status;
    expect([200, 401]).toContain(status);
    return status === 200;
  };
  const account = (id: string) => db.owner.user.findUniqueOrThrow({ where: { id }, select: { blockedAt: true, sessionsValidFrom: true } });

  beforeAll(async () => {
    db = await createTestDatabase();
    await db.owner.tenant.createMany({ data: [TENANT_A, TENANT_B].map((id) => ({ id, name: 'Ferme', currency: 'XOF' })) });
    const user = (id: string, tenantId: string, role: 'admin' | 'collaborator', rank: number) => ({ id, tenantId, role, phone: `+22177000${String(rank).padStart(4, '0')}`, name: 'Compte', pinHash: PIN_HASH });
    await db.owner.user.createMany({
      data: [
        user(OUSMANE, TENANT_A, 'collaborator', 1),
        user(AWA, TENANT_A, 'collaborator', 2),
        user(LE_GERANT, TENANT_A, 'admin', 3),
        user(CO_GERANT, TENANT_A, 'admin', 4),
        user(GARDIEN_DE_B, TENANT_B, 'collaborator', 5),
        user(ADMIN_DE_B, TENANT_B, 'admin', 6),
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

  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });

  describe('bloquer', () => {
    it("l'admin bloque un gardien : tous ses appareils sont refusés dès la requête suivante", async () => {
      // Given Ousmane connecté sur deux téléphones
      at('2026-11-07T08:00:00.000Z');
      const phone = tokenOf(OUSMANE, TENANT_A, 'collaborator');
      const secondPhone = tokenOf(OUSMANE, TENANT_A, 'collaborator', SECOND_TELEPHONE);
      at('2026-11-07T09:00:00.000Z');
      expect(await sessionWorks(phone)).toBe(true);

      // When le gérant le bloque
      const response = await act('block', OUSMANE);

      // Then
      expect(response.status).toBe(204);
      expect(await sessionWorks(phone)).toBe(false);
      expect(await sessionWorks(secondPhone)).toBe(false);
      expect(await account(OUSMANE)).toEqual({ blockedAt: new Date('2026-11-07T09:00:00.000Z'), sessionsValidFrom: new Date('2026-11-07T09:00:00.000Z') });
    });

    it('bloquer un compte déjà bloqué ne change pas la date du blocage', async () => {
      at('2026-11-07T10:00:00.000Z');

      expect((await act('block', OUSMANE)).status).toBe(204);
      expect((await account(OUSMANE)).blockedAt).toEqual(new Date('2026-11-07T09:00:00.000Z'));
    });
  });

  describe('débloquer', () => {
    it("débloquer ne rend pas valides les jetons émis avant : il faut se reconnecter", async () => {
      // Given un jeton émis avant le blocage de 9 h
      at('2026-11-07T08:30:00.000Z');
      const before = tokenOf(OUSMANE, TENANT_A, 'collaborator');

      // When le gérant débloque à 11 h
      at('2026-11-07T11:00:00.000Z');
      expect((await act('unblock', OUSMANE)).status).toBe(204);

      // Then le vieux jeton reste refusé ; un jeton émis après la levée passe
      expect((await account(OUSMANE)).blockedAt).toBeNull();
      expect(await sessionWorks(before)).toBe(false);
      at('2026-11-07T11:00:01.000Z');
      expect(await sessionWorks(tokenOf(OUSMANE, TENANT_A, 'collaborator'))).toBe(true);
    });
  });

  describe('déconnecter partout', () => {
    it("invalide les jetons du compte sans le bloquer : il se reconnecte", async () => {
      at('2026-11-07T12:00:00.000Z');
      const before = tokenOf(AWA, TENANT_A, 'collaborator');
      at('2026-11-07T12:30:00.000Z');

      expect((await act('sign-out-everywhere', AWA)).status).toBe(204);

      expect(await sessionWorks(before)).toBe(false);
      expect((await account(AWA)).blockedAt).toBeNull();
      at('2026-11-07T12:30:01.000Z');
      expect(await sessionWorks(tokenOf(AWA, TENANT_A, 'collaborator'))).toBe(true);
    });

    it("l'admin se déconnecte lui-même de partout : ordinateur oublié, téléphone perdu", async () => {
      at('2026-11-07T13:00:00.000Z');
      const old = gerant();
      at('2026-11-07T13:10:00.000Z');

      expect((await act('sign-out-everywhere', LE_GERANT, old)).status).toBe(204);
      expect(await sessionWorks(old)).toBe(false);
      at('2026-11-07T13:10:01.000Z');
    });
  });

  describe('les limites', () => {
    it("l'admin ne bloque pas son propre compte", async () => {
      const response = await act('block', LE_GERANT);

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ kind: 'CannotBlockOwnAccount' });
      expect((await account(LE_GERANT)).blockedAt).toBeNull();
    });

    it("l'admin ne bloque pas un autre admin : seuls les comptes de l'équipe se bloquent", async () => {
      const response = await act('block', CO_GERANT);

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ kind: 'OnlyCollaboratorsCanBeBlocked' });
      expect((await account(CO_GERANT)).blockedAt).toBeNull();
    });

    it("un compte d'un autre élevage n'existe pas : 404, et rien ne change chez lui", async () => {
      for (const action of ['block', 'unblock', 'sign-out-everywhere'] as const) {
        expect((await act(action, GARDIEN_DE_B)).status).toBe(404);
      }
      expect(await account(GARDIEN_DE_B)).toEqual({ blockedAt: null, sessionsValidFrom: null });
    });

    it("un identifiant qui n'en est pas un : 404", async () => {
      expect((await act('block', 'pas-un-uuid')).status).toBe(404);
    });

    it("un gardien ne bloque, ne débloque ni ne déconnecte personne, pas même lui-même : 403", async () => {
      const awa = tokenOf(AWA, TENANT_A, 'collaborator');

      for (const [action, target] of [['block', OUSMANE], ['unblock', OUSMANE], ['sign-out-everywhere', OUSMANE], ['sign-out-everywhere', AWA]] as const) {
        expect((await act(action, target, awa)).status).toBe(403);
      }
    });
  });
});
