import { unwrap } from '@kit';
import { TenantId } from '@domain/journal';
import { PrismaService } from '../database/prisma.service';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';

// Spec: backlog D.2 — un tenant ne voit jamais un autre tenant ; Archi §6 ; CLAUDE.md §4
// règles 5 (tenant partout) et 6 (fail-closed). Tourne sur un PostgreSQL réel : c'est la base
// elle-même qui refuse, pas seulement le code.
// Generous: the first run pulls the PostgreSQL image, and every worker boots a container.
jest.setTimeout(180_000);

const TENANT_A = unwrap(TenantId('00000000-0000-4000-8000-00000000000a'));
const TENANT_B = unwrap(TenantId('00000000-0000-4000-8000-00000000000b'));
const SITE_A = '00000000-0000-4000-8000-0000000000a1';
const SITE_B = '00000000-0000-4000-8000-0000000000b1';
const TABLES = ['tenants', 'users', 'sites', 'site_assignments', 'campaigns', 'journal_events', 'audit_events'];

describe('Cloisonnement entre élevages', () => {
  let db: TestDatabase;
  let api: PrismaService;

  beforeAll(async () => {
    // Given deux élevages, chacun avec un site, un gardien affecté, une campagne et un événement au journal — semés par le propriétaire de la base
    db = await createTestDatabase();
    for (const [tenantId, siteId, suffix] of [
      [TENANT_A, SITE_A, 'a'],
      [TENANT_B, SITE_B, 'b'],
    ] as const) {
      const userId = `00000000-0000-4000-8000-0000000000${suffix}2`;
      await db.owner.tenant.create({ data: { id: tenantId, name: `Élevage ${suffix.toUpperCase()}`, currency: 'XOF' } });
      await db.owner.site.create({ data: { id: siteId, tenantId, name: `Poulailler ${suffix.toUpperCase()}`, timeZone: 'Africa/Dakar' } });
      await db.owner.user.create({ data: { id: userId, tenantId, phone: `+22177000000${suffix === 'a' ? 1 : 2}`, name: 'Gardien', role: 'collaborator', pinHash: '$argon2id$v=19$m=19456,t=2,p=1$dGVzdC1vbmx5LXNhbHQ$dGVzdC1vbmx5LWRpZ2VzdC1ub3QtYS1yZWFsLXBpbg' } });
      await db.owner.siteAssignment.create({ data: { tenantId, siteId, userId, isPrimary: true } });
      const campaignId = `00000000-0000-4000-8000-0000000000${suffix}3`;
      await db.owner.campaign.create({ data: { id: campaignId, tenantId, siteId, placementDay: new Date('2026-10-15') } });
      await db.owner.journalEvent.create({
        data: {
          id: '00000000-0000-4000-8000-0000000000e1',
          tenantId,
          siteId,
          campaignId,
          authorId: userId,
          businessDate: new Date('2026-11-05'),
          recordedAt: new Date('2026-11-05T18:30:00.000Z'),
          type: 'Death',
          fact: { quantity: 3 },
        },
      });
    }
    // The API connects as the application role, never as the owner.
    api = new PrismaService({ port: 0, databaseUrl: db.appUrl, jwtSecret: 'un-secret-de-test-assez-long-pour-signer-des-jetons' });
  });

  afterAll(async () => {
    await api?.$disconnect();
    await db?.drop();
  });

  const countAll = (client: Pick<PrismaService, '$queryRawUnsafe'>) =>
    Promise.all(
      TABLES.map(async (table) => {
        const [row] = await client.$queryRawUnsafe<{ count: number }[]>(`SELECT count(*)::int AS count FROM "${table}"`);
        return [table, row?.count] as const;
      }),
    ).then(Object.fromEntries);

  describe('sans tenant fixé', () => {
    it("aucune ligne n'est visible, dans aucune table", async () => {
      expect(await countAll(api)).toEqual({ tenants: 0, users: 0, sites: 0, site_assignments: 0, campaigns: 0, journal_events: 0, audit_events: 0 });
    });

    it("rien ne s'écrit", async () => {
      const write = api.site.create({ data: { id: '00000000-0000-4000-8000-0000000000a8', tenantId: TENANT_A, name: 'Sans tenant', timeZone: 'Africa/Dakar' } });

      await expect(write).rejects.toThrow(/row-level security/);
    });
  });

  describe('un élevage ne voit que lui', () => {
    it("un utilisateur de l'élevage A ne lit aucune ligne de l'élevage B, dans aucune table", async () => {
      // When chaque élevage compte ce qu'il voit, et lit ses sites
      const seenByA = await api.runInTenant(TENANT_A, (tx) => countAll(tx));
      const sitesOfA = await api.runInTenant(TENANT_A, (tx) => tx.site.findMany());
      const sitesOfB = await api.runInTenant(TENANT_B, (tx) => tx.site.findMany());

      // Then une ligne par table, la sienne
      expect(seenByA).toEqual({ tenants: 1, users: 1, sites: 1, site_assignments: 1, campaigns: 1, journal_events: 1, audit_events: 0 });
      expect(sitesOfA.map((site) => site.name)).toEqual(['Poulailler A']);
      expect(sitesOfB.map((site) => site.name)).toEqual(['Poulailler B']);
    });

    it("demander explicitement une ligne de B depuis A ne la rend pas", async () => {
      const found = await api.runInTenant(TENANT_A, (tx) => tx.site.findUnique({ where: { id: SITE_B } }));

      expect(found).toBeNull();
    });

    it("un utilisateur de A n'écrit pas une ligne au nom de B", async () => {
      const write = api.runInTenant(TENANT_A, (tx) =>
        tx.site.create({ data: { id: '00000000-0000-4000-8000-0000000000b8', tenantId: TENANT_B, name: 'Intrus', timeZone: 'Africa/Dakar' } }),
      );

      await expect(write).rejects.toThrow(/row-level security/);
      expect(await db.owner.site.count({ where: { name: 'Intrus' } })).toBe(0);
    });

    it("un utilisateur de A ne modifie pas une ligne de B : elle n'existe pas pour lui", async () => {
      const updated = await api.runInTenant(TENANT_A, (tx) => tx.site.updateMany({ where: { id: SITE_B }, data: { name: 'Renommé par A' } }));

      expect(updated.count).toBe(0);
      expect(await db.owner.site.findUniqueOrThrow({ where: { id: SITE_B } })).toMatchObject({ name: 'Poulailler B' });
    });

    it("un utilisateur de A n'écrit pas une ligne au nom de B, même sans relire ce qu'il écrit", async () => {
      // When une écriture brute, sans RETURNING : seule la règle d'écriture de la politique peut la refuser
      const write = api.runInTenant(TENANT_A, (tx) =>
        tx.$executeRaw`INSERT INTO sites (id, tenant_id, name, time_zone) VALUES ('00000000-0000-4000-8000-0000000000b9'::uuid, ${TENANT_B}::uuid, 'Intrus discret', 'Africa/Dakar')`,
      );

      await expect(write).rejects.toThrow(/row-level security/);
      expect(await db.owner.site.count({ where: { name: 'Intrus discret' } })).toBe(0);
    });

    it("un utilisateur de A ne fait pas passer une de ses lignes chez B", async () => {
      // Given un site de A dont rien ne dépend : aucune clé étrangère ne le retient
      const lonely = '00000000-0000-4000-8000-0000000000a4';
      await db.owner.site.create({ data: { id: lonely, tenantId: TENANT_A, name: 'Site sans attache', timeZone: 'Africa/Dakar' } });

      // When
      const moved = api.runInTenant(TENANT_A, (tx) => tx.$executeRaw`UPDATE sites SET tenant_id = ${TENANT_B}::uuid WHERE id = ${lonely}::uuid`);

      // Then
      await expect(moved).rejects.toThrow(/row-level security/);
      expect(await db.owner.site.findUniqueOrThrow({ where: { id: lonely } })).toMatchObject({ tenantId: TENANT_A });
      await db.owner.site.delete({ where: { id: lonely } });
    });

    it("même le propriétaire de la base ne déplace pas un site qui a des lignes attachées : rien ne se propage", async () => {
      const moved = db.owner.$executeRaw`UPDATE sites SET tenant_id = ${TENANT_B}::uuid WHERE id = ${SITE_A}::uuid`;

      await expect(moved).rejects.toThrow(/23503|23001|foreign key/i);
      expect(await db.owner.campaign.count({ where: { tenantId: TENANT_A } })).toBe(1);
    });

    it("un élevage écrit chez lui", async () => {
      const created = await api.runInTenant(TENANT_A, (tx) =>
        tx.site.create({ data: { id: '00000000-0000-4000-8000-0000000000a7', tenantId: TENANT_A, name: 'Second poulailler', timeZone: 'Africa/Dakar' } }),
      );

      expect(created).toMatchObject({ tenantId: TENANT_A, name: 'Second poulailler' });
      await db.owner.site.delete({ where: { id: created.id } });
    });
  });

  describe('la connexion trouve son utilisateur par son numéro', () => {
    it("une transaction qui nomme un numéro voit cette ligne, et rien d'autre", async () => {
      const seen = await api.findUserForSignIn('+221770000002');
      const seenOfNobody = await api.findUserForSignIn('+221770000099');

      expect(seen).toMatchObject({ tenantId: TENANT_B, phone: '+221770000002' });
      expect(seenOfNobody).toBeNull();
    });

    it("nommer un numéro n'ouvre ni les autres comptes, ni une autre table, ni l'écriture", async () => {
      const others = await api.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.sign_in_phone', ${'+221770000002'}, true)`;
        return { users: await tx.user.count(), sites: await tx.site.count(), journal: await tx.journalEvent.count() };
      });
      const written = await api.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.sign_in_phone', ${'+221770000002'}, true)`;
        return tx.user.updateMany({ where: { phone: '+221770000002' }, data: { name: 'Renommé sans élevage' } });
      });

      // PostgreSQL skips the rows an UPDATE policy hides: nothing is written, without an error
      expect(others).toEqual({ users: 1, sites: 0, journal: 0 });
      expect(written.count).toBe(0);
      expect(await db.owner.user.findFirstOrThrow({ where: { phone: '+221770000002' } })).toMatchObject({ name: 'Gardien' });
    });

    it("le numéro posé ne survit pas à la transaction", async () => {
      await api.findUserForSignIn('+221770000002');

      expect(await api.user.count()).toBe(0);
    });
  });

  describe('le tenant est fixé dans la transaction', () => {
    it('deux requêtes concurrentes de tenants différents ne se mélangent pas dans le pool de connexions', async () => {
      // When quarante lectures entrelacées, chacune retenue un instant pour qu'elles se chevauchent
      const readSlowly = (tenantId: TenantId) =>
        api.runInTenant(tenantId, async (tx) => {
          await tx.$executeRaw`SELECT pg_sleep(0.02)`;
          return (await tx.site.findMany()).map((site) => site.name);
        });
      const seen = await Promise.all(Array.from({ length: 40 }, (_, rank) => readSlowly(rank % 2 === 0 ? TENANT_A : TENANT_B)));

      // Then chacune n'a vu que son élevage
      seen.forEach((names, rank) => expect(names).toEqual([rank % 2 === 0 ? 'Poulailler A' : 'Poulailler B']));
    });

    it("le tenant ne survit pas à la transaction : la connexion rendue au pool ne voit plus rien", async () => {
      await api.runInTenant(TENANT_A, (tx) => tx.site.findMany());

      // Then, sur toutes les connexions du pool, une lecture hors transaction ne voit rien
      const after = await Promise.all(Array.from({ length: 20 }, () => api.site.count()));
      expect(after).toEqual(Array.from({ length: 20 }, () => 0));
    });

    it("une transaction imbriquée du même élevage rejoint la première : elle voit ce qui n'est pas encore validé", async () => {
      // Given un travail qui écrit un site, appelle un autre travail du même élevage, puis échoue
      let seenByTheNestedWork = 0;
      const work = api.runInTenant(TENANT_A, async (tx) => {
        await tx.site.create({ data: { id: '00000000-0000-4000-8000-0000000000a5', tenantId: TENANT_A, name: 'Pas encore validé', timeZone: 'Africa/Dakar' } });
        seenByTheNestedWork = await api.runInTenant(TENANT_A, (inner) => inner.site.count());
        throw new Error('on annule tout');
      });

      // Then le travail imbriqué a vu les deux sites, et rien ne reste après l'échec
      await expect(work).rejects.toThrow('on annule tout');
      expect(seenByTheNestedWork).toBe(2);
      expect(await db.owner.site.count({ where: { tenantId: TENANT_A } })).toBe(1);
    });

    it("une transaction imbriquée pour un autre élevage est refusée", async () => {
      const crossed = api.runInTenant(TENANT_A, () => api.runInTenant(TENANT_B, (tx) => tx.site.count()));

      await expect(crossed).rejects.toThrow(/tenant/i);
    });

    it("si le travail échoue, rien de ce qu'il a écrit ne reste", async () => {
      const failing = api.runInTenant(TENANT_A, async (tx) => {
        await tx.site.create({ data: { id: '00000000-0000-4000-8000-0000000000a6', tenantId: TENANT_A, name: 'À moitié écrit', timeZone: 'Africa/Dakar' } });
        throw new Error('panne au milieu du travail');
      });

      await expect(failing).rejects.toThrow('panne au milieu du travail');
      expect(await db.owner.site.count({ where: { name: 'À moitié écrit' } })).toBe(0);
    });
  });

  describe("le rôle de l'application", () => {
    it("n'est ni superutilisateur, ni dispensé de RLS, ni propriétaire d'une table, et ne crée ni rôle ni base", async () => {
      const [role] = await api.$queryRaw<Record<string, boolean>[]>`
        SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = current_user`;
      const owned = await db.owner.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE tableowner = 'yaar_app'`;

      expect(role).toEqual({ rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false });
      expect(owned).toEqual([]);
    });

    it('toute table a sa RLS activée et forcée, avec une politique — une table ajoutée sans elle fait échouer ce test', async () => {
      const tables = await db.owner.$queryRaw<{ name: string; enabled: boolean; forced: boolean; policies: number }[]>`
        SELECT t.relname AS name, t.relrowsecurity AS enabled, t.relforcerowsecurity AS forced,
               (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = t.oid) AS policies
          FROM pg_class t JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'public' AND t.relkind = 'r' AND t.relname <> '_prisma_migrations'
         ORDER BY t.relname`;

      // `users` has a second policy: the one that lets a sign-in find its row by phone number.
      expect(tables).toEqual([...TABLES].sort().map((name) => ({ name, enabled: true, forced: true, policies: name === 'users' ? 2 : 1 })));
    });

    it("n'a que les droits accordés table par table : lire et écrire, jamais supprimer ni vider, et seulement lire son élevage", async () => {
      // Lu dans le catalogue : un droit accordé en trop par une migration fait échouer ce test.
      const grants = await db.owner.$queryRaw<{ table_name: string; privileges: string }[]>`
        SELECT table_name::text, string_agg(privilege_type::text, ',' ORDER BY privilege_type) AS privileges
          FROM information_schema.role_table_grants
         WHERE grantee = 'yaar_app' AND table_schema = 'public'
         GROUP BY table_name ORDER BY table_name`;

      expect(grants).toEqual([
        { table_name: 'audit_events', privileges: 'INSERT,SELECT' },
        { table_name: 'campaigns', privileges: 'INSERT,SELECT,UPDATE' },
        { table_name: 'journal_events', privileges: 'INSERT,SELECT' },
        { table_name: 'site_assignments', privileges: 'INSERT,SELECT,UPDATE' },
        { table_name: 'sites', privileges: 'INSERT,SELECT,UPDATE' },
        { table_name: 'tenants', privileges: 'SELECT' },
        { table_name: 'users', privileges: 'INSERT,SELECT,UPDATE' },
      ]);
    });

    it("ne supprime aucune ligne, ne crée pas d'élevage, ne touche ni à la structure ni au registre des migrations", async () => {
      const attempts: (() => Promise<unknown>)[] = [
        () => api.runInTenant(TENANT_A, (tx) => tx.site.deleteMany()),
        () => api.runInTenant(TENANT_A, (tx) => tx.tenant.create({ data: { id: '00000000-0000-4000-8000-00000000000c', name: 'Élevage C', currency: 'XOF' } })),
        () => api.runInTenant(TENANT_A, (tx) => tx.$executeRawUnsafe('TRUNCATE sites CASCADE')),
        () => api.$executeRawUnsafe('CREATE TABLE intruder (id int)'),
        () => api.$executeRawUnsafe('ALTER TABLE sites DISABLE ROW LEVEL SECURITY'),
        () => api.$queryRawUnsafe('SELECT * FROM _prisma_migrations'),
      ];

      for (const attempt of attempts) {
        await expect(attempt()).rejects.toThrow(/permission denied|must be owner|42501/i);
      }
      expect(await db.owner.site.count()).toBe(2);
      expect(await db.owner.tenant.count()).toBe(2);
    });
  });
});
