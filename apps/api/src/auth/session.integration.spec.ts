import { Controller, Get, Param, Post, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { unwrap, type Clock } from '@kit';
import { Instant, TenantId } from '@domain/journal';
import { AppModule } from '../app.module';
import { APP_CONFIG } from '../config/app-config';
import { configureApp } from '../create-app';
import { PrismaService } from '../database/prisma.service';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';
import { issueAccessToken, type SessionClaims } from './access-token';
import { CLOCK } from './auth.module';
import { CurrentSession, Roles, type Session } from './session';
import { canReachSite } from './site-access';

// Spec: backlog E.3 — les routes sont fermées par défaut ; CLAUDE.md §4 règles 5 (le tenant
// vient de la session, jamais du client) et 6 (fail-closed) ; CdC « Identité » (compte bloqué,
// jetons invalidés). Tourne sur un PostgreSQL réel, à travers le serveur HTTP.
jest.setTimeout(180_000);

const SECRET = 'un-secret-de-test-assez-long-pour-signer-des-jetons';
const NOW = '2026-11-07T08:00:00.000Z';
const TENANT_A = '00000000-0000-4000-8000-00000000000a';
const TENANT_B = '00000000-0000-4000-8000-00000000000b';
const SITE_A1 = '00000000-0000-4000-8000-0000000000a1';
const SITE_A2 = '00000000-0000-4000-8000-0000000000a2';
const SITE_B1 = '00000000-0000-4000-8000-0000000000b1';
const OUSMANE = '00000000-0000-4000-8000-000000000051';
const LE_GERANT = '00000000-0000-4000-8000-000000000054';
const DE_B = '00000000-0000-4000-8000-0000000000b5';
const DEVICE = '00000000-0000-4000-8000-0000000000d1';
const PIN_HASH = '$argon2id$v=19$m=19456,t=2,p=1$dGVzdC1vbmx5LXNhbHQ$dGVzdC1vbmx5LWRpZ2VzdC1ub3QtYS1yZWFsLXBpbg';

let handled = 0;

// Routes written for the test, without @Public(): they stand for any route of the API.
@Controller('probe')
class ProbeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('me')
  async me(@CurrentSession() session: Session) {
    handled += 1;
    const sites = await this.prisma.runInTenant(session.tenantId, (tx) => tx.site.findMany({ orderBy: { id: 'asc' }, select: { id: true } }));
    return { session, sites: sites.map((site) => site.id) };
  }

  @Post('me')
  async write(@CurrentSession() session: Session) {
    return this.me(session);
  }

  @Get('raw')
  async raw() {
    // A handler that forgets its tenant: outside `runInTenant`, row-level security shows nothing.
    return { sites: (await this.prisma.site.findMany({ select: { id: true } })).length };
  }

  @Post('half-done')
  async halfDone(@CurrentSession() session: Session) {
    await this.prisma.runInTenant(session.tenantId, (tx) =>
      tx.site.update({ where: { id: SITE_A2 }, data: { name: 'Écrit puis annulé' } }),
    );
    throw new Error('panne après une écriture');
  }

  @Roles('admin')
  @Get('admin')
  admin(@CurrentSession() session: Session) {
    return { role: session.role };
  }

  @Get('sites/:siteId')
  async site(@CurrentSession() session: Session, @Param('siteId') siteId: string) {
    const reachable = await this.prisma.runInTenant(session.tenantId, (tx) => canReachSite(tx, session, siteId));
    return { reachable };
  }
}

describe('Session à chaque requête', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let origin: string;
  let now = Date.parse(NOW);
  const clock: Clock = { now: () => new Date(now) };

  const tokenFor = (claims: Omit<SessionClaims, 'iat' | 'exp'>, at = NOW, secret = SECRET) => issueAccessToken(claims, unwrap(Instant(at)), secret);
  const ousmane = { sub: OUSMANE, tenant: TENANT_A, role: 'collaborator' as const, device: DEVICE };
  const gerant = { sub: LE_GERANT, tenant: TENANT_A, role: 'admin' as const, device: DEVICE };
  const call = (path: string, token?: string, init: RequestInit = {}) =>
    fetch(`${origin}/api/v1/probe/${path}`, { ...init, headers: { ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }), 'Content-Type': 'application/json' } });

  beforeAll(async () => {
    db = await createTestDatabase();
    for (const [tenantId, sites] of [[TENANT_A, [SITE_A1, SITE_A2]], [TENANT_B, [SITE_B1]]] as const) {
      await db.superuser.tenant.create({ data: { id: tenantId, name: 'Ferme', currency: 'XOF' } });
      for (const siteId of sites) {
        await db.superuser.site.create({ data: { id: siteId, tenantId, name: 'Poulailler', timeZone: 'Africa/Dakar' } });
      }
    }
    await db.superuser.user.createMany({
      data: [
        { id: OUSMANE, tenantId: TENANT_A, phone: '+221770000051', name: 'Ousmane', role: 'collaborator', pinHash: PIN_HASH },
        { id: LE_GERANT, tenantId: TENANT_A, phone: '+221770000054', name: 'Le gérant', role: 'admin', pinHash: PIN_HASH },
        { id: DE_B, tenantId: TENANT_B, phone: '+221770000055', name: 'Admin de B', role: 'admin', pinHash: PIN_HASH },
      ],
    });
    await db.superuser.siteAssignment.create({ data: { tenantId: TENANT_A, siteId: SITE_A1, userId: OUSMANE, isPrimary: true } });

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

  beforeEach(() => {
    now = Date.parse(NOW);
  });

  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });

  describe('une route sans marque exige une session valide', () => {
    it('sans jeton, ou avec un en-tête qui n’en porte pas un, la requête est refusée en 401', async () => {
      for (const header of [undefined, '', 'Bearer', 'Bearer ', 'Basic abc', `Token ${tokenFor(ousmane)}`]) {
        const response = await fetch(`${origin}/api/v1/probe/me`, { headers: header === undefined ? {} : { Authorization: header } });
        expect(response.status).toBe(401);
      }
    });

    it('un jeton valide ouvre la route et donne la session : utilisateur, élevage, rôle, appareil', async () => {
      const response = await call('me', tokenFor(ousmane));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        session: { userId: OUSMANE, tenantId: TENANT_A, role: 'collaborator', deviceId: DEVICE },
        sites: [SITE_A1, SITE_A2],
      });
    });

    it('un jeton expiré, signé avec un autre secret ou modifié est refusé, sans que la route ne tourne', async () => {
      handled = 0;
      const valid = tokenFor(ousmane);
      const refused = [
        tokenFor(ousmane, '2026-10-30T08:00:00.000Z'),
        tokenFor(ousmane, NOW, 'un-autre-secret-tout-aussi-long-mais-different!!'),
        `${valid.slice(0, -2)}xx`,
      ];

      for (const token of refused) {
        expect((await call('me', token)).status).toBe(401);
      }
      expect(handled).toBe(0);
    });
  });

  describe("le tenant vient du jeton, jamais d'un paramètre ni du corps", () => {
    it("un élevage demandé dans l'adresse ou dans le corps est ignoré : on ne voit que le sien", async () => {
      const byQuery = await (await call(`me?tenantId=${TENANT_B}`, tokenFor(ousmane))).json();
      const byBody = await (await call('me', tokenFor(ousmane), { method: 'POST', body: JSON.stringify({ tenantId: TENANT_B, tenant: TENANT_B }) })).json();

      for (const body of [byQuery, byBody]) {
        expect(body).toMatchObject({ session: { tenantId: TENANT_A }, sites: [SITE_A1, SITE_A2] });
      }
    });

    it("une route qui oublie de fixer son élevage ne voit rien, même avec une session valide : fail-closed", async () => {
      expect(await (await call('raw', tokenFor(ousmane))).json()).toEqual({ sites: 0 });
    });

    it("un jeton qui associe un utilisateur à un autre élevage que le sien est refusé", async () => {
      expect((await call('me', tokenFor({ ...ousmane, tenant: TENANT_B }))).status).toBe(401);
    });
  });

  describe('le compte est relu à chaque requête', () => {
    it("un compte bloqué est refusé dès la requête suivante, avec un jeton encore valide", async () => {
      const token = tokenFor(ousmane);
      expect((await call('me', token)).status).toBe(200);

      await db.superuser.user.update({ where: { id: OUSMANE }, data: { blockedAt: new Date(NOW) } });
      try {
        expect((await call('me', token)).status).toBe(401);
      } finally {
        await db.superuser.user.update({ where: { id: OUSMANE }, data: { blockedAt: null } });
      }
    });

    it("un jeton émis avant la date d'invalidation est refusé ; un jeton émis après est accepté", async () => {
      // Given les jetons du compte invalidés le 7 à 9 h 00 min 00,4 s
      await db.superuser.user.update({ where: { id: OUSMANE }, data: { sessionsValidFrom: new Date('2026-11-07T09:00:00.400Z') } });
      now = Date.parse('2026-11-07T10:00:00.000Z');
      try {
        // Then émis à 8 h, ou dans la même seconde que l'invalidation : refusés ; à 9 h 00 min 01 : accepté
        expect((await call('me', tokenFor(ousmane, '2026-11-07T08:00:00.000Z'))).status).toBe(401);
        expect((await call('me', tokenFor(ousmane, '2026-11-07T09:00:00.000Z'))).status).toBe(401);
        expect((await call('me', tokenFor(ousmane, '2026-11-07T09:00:01.000Z'))).status).toBe(200);
      } finally {
        await db.superuser.user.update({ where: { id: OUSMANE }, data: { sessionsValidFrom: null } });
      }
    });

    it("un jeton dont le rôle n'est plus celui du compte est refusé", async () => {
      await db.superuser.user.update({ where: { id: LE_GERANT }, data: { role: 'collaborator' } });
      try {
        expect((await call('admin', tokenFor(gerant))).status).toBe(401);
        expect((await call('me', tokenFor(gerant))).status).toBe(401);
      } finally {
        await db.superuser.user.update({ where: { id: LE_GERANT }, data: { role: 'admin' } });
      }
    });

    it("un compte qui n'existe pas est refusé", async () => {
      expect((await call('me', tokenFor({ ...ousmane, sub: '00000000-0000-4000-8000-000000000099' }))).status).toBe(401);
    });
  });

  describe('une requête, une transaction', () => {
    it("ce qu'une route écrit avant d'échouer est annulé avec le reste : elle rejoint la transaction de la requête", async () => {
      const response = await call('half-done', tokenFor(gerant), { method: 'POST' });

      expect(response.status).toBe(500);
      expect(await db.superuser.site.findUniqueOrThrow({ where: { id: SITE_A2 } })).toMatchObject({ name: 'Poulailler' });
    });
  });

  describe('les rôles', () => {
    it("une route réservée à l'admin refuse un collaborateur en 403, et s'ouvre à l'admin", async () => {
      expect((await call('admin', tokenFor(ousmane))).status).toBe(403);
      const admin = await call('admin', tokenFor(gerant));
      expect(admin.status).toBe(200);
      expect(await admin.json()).toEqual({ role: 'admin' });
    });
  });

  describe('les sites', () => {
    it("un collaborateur n'atteint que les sites où il est affecté ; l'admin, tous ceux de son élevage ; personne ceux d'un autre", async () => {
      const reach = async (claims: typeof ousmane | typeof gerant, siteId: string) => ((await (await call(`sites/${siteId}`, tokenFor(claims))).json()) as { reachable: boolean }).reachable;

      expect(await reach(ousmane, SITE_A1)).toBe(true);
      expect(await reach(ousmane, SITE_A2)).toBe(false);
      expect(await reach(ousmane, SITE_B1)).toBe(false);
      expect(await reach(gerant, SITE_A1)).toBe(true);
      expect(await reach(gerant, SITE_A2)).toBe(true);
      expect(await reach(gerant, SITE_B1)).toBe(false);
      expect(await reach(gerant, 'pas-un-uuid')).toBe(false);
    });
  });

  it('une route ouverte par @Public() reste ouverte sans jeton, et avec un jeton invalide', async () => {
    expect((await fetch(`${origin}/api/v1/health`)).status).toBe(200);
    expect((await fetch(`${origin}/api/v1/health`, { headers: { Authorization: 'Bearer nimporte.quoi.la' } })).status).toBe(200);
  });

  it('les tenants restent ceux de la base : vérification de cohérence du jeu de test', async () => {
    const api = new PrismaService({ port: 0, databaseUrl: db.appUrl, jwtSecret: SECRET, mediaPath: '/data/medias', vapidPublicKey: null });
    try {
      expect(await api.runInTenant(unwrap(TenantId(TENANT_B)), (tx) => tx.site.count())).toBe(1);
    } finally {
      await api.$disconnect();
    }
  });
});
