import { createTestDatabase, migrate, type TestDatabase } from '../testing/test-database';

// Spec: backlog D.1 — la migration initiale s'applique sur une base vide ; Archi §6 ;
// CLAUDE.md §4 règle 5 (tenant partout). Tourne sur un PostgreSQL réel.
// Generous: the first run pulls the PostgreSQL image, and every worker boots a container.
jest.setTimeout(180_000);

const TENANT_A = '00000000-0000-4000-8000-00000000000a';
const TENANT_B = '00000000-0000-4000-8000-00000000000b';
const SITE_A = '00000000-0000-4000-8000-0000000000a1';
const SITE_B = '00000000-0000-4000-8000-0000000000b1';
const OUSMANE = '00000000-0000-4000-8000-0000000000a2';
const AWA = '00000000-0000-4000-8000-0000000000a3';
const MODOU = '00000000-0000-4000-8000-0000000000a4';

describe('Migrations', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    // Given une base vide sur laquelle on rejoue les migrations du dépôt, puis deux élevages
    db = await createTestDatabase();
    await db.superuser.tenant.createMany({
      data: [
        { id: TENANT_A, name: 'Élevage A', currency: 'XOF' },
        { id: TENANT_B, name: 'Élevage B', currency: 'XOF' },
      ],
    });
    await db.superuser.site.createMany({
      data: [
        { id: SITE_A, tenantId: TENANT_A, name: 'Poulailler A', timeZone: 'Africa/Dakar' },
        { id: SITE_B, tenantId: TENANT_B, name: 'Poulailler B', timeZone: 'Africa/Douala' },
      ],
    });
    await db.superuser.user.createMany({
      data: [OUSMANE, AWA, MODOU].map((id, rank) => ({
        id,
        tenantId: TENANT_A,
        phone: `+22177000000${rank}`,
        name: `Gardien ${rank}`,
        role: 'collaborator' as const,
        pinHash: '$argon2id$v=19$m=19456,t=2,p=1$dGVzdC1vbmx5LXNhbHQ$dGVzdC1vbmx5LWRpZ2VzdC1ub3QtYS1yZWFsLXBpbg',
      })),
    });
  });

  afterAll(async () => {
    await db?.drop();
  });

  it("les migrations s'appliquent sur une base vide et créent les neuf tables", async () => {
    const tables = await db.superuser.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename`;

    expect(tables.map((table) => table.tablename)).toEqual(['audit_events', 'campaigns', 'counterparties', 'journal_events', 'refused_events', 'site_assignments', 'sites', 'tenants', 'users']);
  });

  it('rejouer les migrations sur une base à jour ne change rien et ne casse rien', async () => {
    expect(() => migrate(db.url)).not.toThrow();
    expect(await db.superuser.site.count()).toBe(2);
  });

  it('toute table porte `tenant_id` obligatoire, avec un index qui commence par lui — sauf `tenants`', async () => {
    // Lu dans le catalogue de PostgreSQL : une table écrite à la main dans une migration y passe aussi.
    const tables = await db.superuser.$queryRaw<{ name: string; tenant_column: boolean; tenant_index: boolean }[]>`
      SELECT t.relname AS name,
             EXISTS (SELECT 1 FROM pg_attribute a
                      WHERE a.attrelid = t.oid AND a.attname = 'tenant_id' AND a.attnotnull
                        AND a.atttypid = 'uuid'::regtype) AS tenant_column,
             EXISTS (SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = i.indkey[0]
                      WHERE i.indrelid = t.oid AND a.attname = 'tenant_id') AS tenant_index
        FROM pg_class t JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname = 'public' AND t.relkind = 'r' AND t.relname NOT IN ('tenants', '_prisma_migrations')
       ORDER BY t.relname`;

    expect(tables).toEqual(
      ['audit_events', 'campaigns', 'counterparties', 'journal_events', 'refused_events', 'site_assignments', 'sites', 'users'].map((name) => ({ name, tenant_column: true, tenant_index: true })),
    );
  });

  it("les identifiants sont des UUID fournis par l'appelant : aucune clé primaire n'a de valeur par défaut, aucune séquence n'existe", async () => {
    const keys = await db.superuser.$queryRaw<{ column_name: string; type: string; has_default: boolean }[]>`
      SELECT c.relname || '.' || a.attname AS column_name, format_type(a.atttypid, a.atttypmod) AS type, (d.adbin IS NOT NULL) AS has_default
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY (i.indkey)
        LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
       WHERE i.indisprimary AND n.nspname = 'public' AND c.relname <> '_prisma_migrations'
       ORDER BY 1`;
    const [sequences] = await db.superuser.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'S'`;

    expect(keys).toEqual(
      [
        'audit_events.id',
        'audit_events.tenant_id',
        'campaigns.id',
        'counterparties.id',
        'journal_events.id',
        'journal_events.tenant_id',
        'refused_events.event_id',
        'refused_events.tenant_id',
        'site_assignments.site_id',
        'site_assignments.user_id',
        'sites.id',
        'tenants.id',
        'users.id',
      ].map((column_name) => ({ column_name, type: 'uuid', has_default: false })),
    );
    expect(sequences).toEqual({ count: 0 });
  });

  it("la base ne fabrique aucune valeur métier : ses seuls défauts sont des dates de création ou de réception, un compteur à zéro et un drapeau éteint", async () => {
    const defaults = await db.superuser.$queryRaw<{ column_name: string; column_default: string }[]>`
      SELECT table_name || '.' || column_name AS column_name, column_default::text
        FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name <> '_prisma_migrations' AND column_default IS NOT NULL
       ORDER BY 1`;

    expect(defaults).toEqual([
      { column_name: 'campaigns.created_at', column_default: 'CURRENT_TIMESTAMP' },
      { column_name: 'counterparties.created_at', column_default: 'CURRENT_TIMESTAMP' },
      { column_name: 'journal_events.received_at', column_default: 'CURRENT_TIMESTAMP' },
      { column_name: 'refused_events.received_at', column_default: 'CURRENT_TIMESTAMP' },
      { column_name: 'site_assignments.created_at', column_default: 'CURRENT_TIMESTAMP' },
      { column_name: 'sites.created_at', column_default: 'CURRENT_TIMESTAMP' },
      { column_name: 'sites.strict_mode', column_default: 'false' },
      { column_name: 'tenants.created_at', column_default: 'CURRENT_TIMESTAMP' },
      { column_name: 'users.created_at', column_default: 'CURRENT_TIMESTAMP' },
      { column_name: 'users.pin_failures', column_default: '0' },
    ]);
  });

  it("la base ne fabrique pas d'identifiant : une ligne écrite sans identifiant est refusée", async () => {
    const withoutId = db.superuser.$executeRaw`INSERT INTO sites (tenant_id, name, time_zone) VALUES (${TENANT_A}::uuid, 'Sans identifiant', 'Africa/Dakar')`;

    // 23502 : PostgreSQL refuse une valeur absente dans une colonne obligatoire
    await expect(withoutId).rejects.toThrow(/Code: `23502`[\s\S]*column \\?"id\\?"/);
    expect(await db.superuser.site.count({ where: { name: 'Sans identifiant' } })).toBe(0);
  });

  it('un site porte son fuseau horaire : sans lui, il ne s’enregistre pas', async () => {
    const withoutTimeZone = db.superuser.$executeRaw`INSERT INTO sites (id, tenant_id, name) VALUES ('00000000-0000-4000-8000-0000000000a9'::uuid, ${TENANT_A}::uuid, 'Sans fuseau')`;

    await expect(withoutTimeZone).rejects.toThrow(/Code: `23502`/);
    expect(await db.superuser.site.count({ where: { name: 'Sans fuseau' } })).toBe(0);
    expect(await db.superuser.site.findUniqueOrThrow({ where: { id: SITE_B } })).toMatchObject({ timeZone: 'Africa/Douala' });
  });

  it("une ligne ne référence que des lignes de son élevage : une campagne de A ne s'attache pas au site de B", async () => {
    const campaign = { placementDay: new Date('2026-10-15'), strain: 'Cobb500', plannedHeadcount: 1000, plannedDuration: 45 };

    await expect(
      db.superuser.campaign.create({ data: { id: '00000000-0000-4000-8000-0000000000c1', tenantId: TENANT_A, siteId: SITE_B, ...campaign } }),
    ).rejects.toThrow(/Foreign key constraint/i);
    await expect(
      db.superuser.campaign.create({ data: { id: '00000000-0000-4000-8000-0000000000c2', tenantId: TENANT_A, siteId: SITE_A, ...campaign } }),
    ).resolves.toMatchObject({ siteId: SITE_A, closedAt: null });
  });

  it("un collaborateur ne s'affecte pas au site d'un autre élevage", async () => {
    const acrossTenants = db.superuser.siteAssignment.create({ data: { tenantId: TENANT_A, siteId: SITE_B, userId: OUSMANE, isPrimary: false } });

    await expect(acrossTenants).rejects.toThrow(/Foreign key constraint/i);
  });

  // Spec: backlog D.6 — le propriétaire de la base n'est pas superutilisateur
  it("les migrations tournent sous le propriétaire des tables, qui n'est ni superutilisateur, ni dispensé de RLS, et ne crée ni rôle ni base", async () => {
    const owners = await db.superuser.$queryRaw<{ owner: string }[]>`
      SELECT DISTINCT tableowner AS owner FROM pg_tables WHERE schemaname = 'public'
      UNION SELECT DISTINCT pg_get_userbyid(p.proowner) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'`;
    const [role] = await db.owner.$queryRaw<Record<string, boolean>[]>`
      SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication FROM pg_roles WHERE rolname = current_user`;

    expect(owners).toEqual([{ owner: 'yaar' }]);
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false });
  });

  it("sans le rôle de l'API, créé avec le serveur de base, la migration s'arrête au lieu de le créer : le propriétaire n'en a pas le droit", async () => {
    // Given une base vide, sur un serveur où le rôle de l'API manque — renommé le temps du test : ce conteneur n'est qu'à ce processus
    const empty = await createTestDatabase({ migrated: false });
    await db.superuser.$executeRawUnsafe('ALTER ROLE yaar_app RENAME TO yaar_app_away');
    try {
      // When
      let failure = '';
      try {
        migrate(empty.url);
      } catch (error) {
        const { stdout, stderr } = error as { stdout?: Buffer; stderr?: Buffer };
        failure = `${String(stdout ?? '')}${String(stderr ?? '')}`;
      }

      // Then la migration a échoué en le disant, et aucun rôle n'a été créé à sa place
      expect(failure).toMatch(/yaar_app is missing/);
      expect(await db.superuser.$queryRaw`SELECT rolname FROM pg_roles WHERE rolname = 'yaar_app'`).toEqual([]);
    } finally {
      await db.superuser.$executeRawUnsafe('ALTER ROLE yaar_app_away RENAME TO yaar_app');
      await empty.drop();
    }
  });

  it("une trace d'audit ne nomme qu'un site de son élevage", async () => {
    const entry = (id: string, siteId: string) => ({ id, tenantId: TENANT_A, occurredAt: new Date('2026-11-07T08:00:00.000Z'), action: 'SiteAssigned' as const, actorId: OUSMANE, subjectId: OUSMANE, siteId });

    await expect(db.superuser.auditEvent.create({ data: entry('00000000-0000-4000-8000-0000000000f1', SITE_B) })).rejects.toThrow(/Foreign key constraint/i);
    await expect(db.superuser.auditEvent.create({ data: entry('00000000-0000-4000-8000-0000000000f2', SITE_A) })).resolves.toMatchObject({ siteId: SITE_A });
  });

  it("un site n'a qu'un titulaire, et autant de remplaçants qu'il faut", async () => {
    // Given Ousmane titulaire, Awa remplaçante
    await db.superuser.siteAssignment.createMany({
      data: [
        { tenantId: TENANT_A, siteId: SITE_A, userId: OUSMANE, isPrimary: true },
        { tenantId: TENANT_A, siteId: SITE_A, userId: AWA, isPrimary: false },
      ],
    });

    // Then un second titulaire est refusé, un second remplaçant est accepté
    const secondPrimary = db.superuser.siteAssignment.create({ data: { tenantId: TENANT_A, siteId: SITE_A, userId: MODOU, isPrimary: true } });
    await expect(secondPrimary).rejects.toThrow(/Unique constraint/i);
    await expect(
      db.superuser.siteAssignment.create({ data: { tenantId: TENANT_A, siteId: SITE_A, userId: MODOU, isPrimary: false } }),
    ).resolves.toMatchObject({ isPrimary: false });
  });

  it("un numéro de téléphone n'a qu'un compte sur tout le service, quel que soit l'élevage", async () => {
    const samePhone = { phone: '+221770000099', name: 'Homonyme', role: 'admin' as const, pinHash: '$argon2id$v=19$m=19456,t=2,p=1$dGVzdC1vbmx5LXNhbHQ$dGVzdC1vbmx5LWRpZ2VzdC1ub3QtYS1yZWFsLXBpbg' };

    await expect(
      db.superuser.user.create({ data: { id: '00000000-0000-4000-8000-0000000000b2', tenantId: TENANT_B, ...samePhone } }),
    ).resolves.toMatchObject({ tenantId: TENANT_B });
    for (const [id, tenantId] of [['00000000-0000-4000-8000-0000000000a5', TENANT_A], ['00000000-0000-4000-8000-0000000000b5', TENANT_B]] as const) {
      await expect(db.superuser.user.create({ data: { id, tenantId, ...samePhone } })).rejects.toThrow(/Unique constraint/i);
    }
  });

  it("un compte porte toujours l'empreinte de son PIN : sans elle, il ne s'enregistre pas", async () => {
    const withoutPin = db.superuser.$executeRaw`INSERT INTO users (id, tenant_id, phone, name, role) VALUES ('00000000-0000-4000-8000-0000000000a6'::uuid, ${TENANT_A}::uuid, '+221770000009', 'Sans PIN', 'admin')`;

    await expect(withoutPin).rejects.toThrow(/Code: `23502`/);
  });
});
