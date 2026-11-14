import { PostgreSqlContainer } from '@testcontainers/postgresql';
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

  it("les migrations s'appliquent sur une base vide et créent les douze tables", async () => {
    const tables = await db.superuser.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename`;

    expect(tables.map((table) => table.tablename)).toEqual(['attachments', 'audit_events', 'budget_lines', 'campaign_leftovers', 'campaigns', 'catalog_prices', 'correction_reviews', 'cost_types', 'costs', 'counterparties', 'journal_events', 'media', 'morning_reminders', 'order_lines', 'payments', 'planned_receptions', 'purchase_orders', 'push_subscriptions', 'reception_alerts', 'refused_events', 'sale_forecasts', 'sale_receipts', 'sales', 'settlements', 'sign_in_attempts', 'site_assignments', 'sites', 'tenants', 'users', 'weighing_requests']);
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
      ['attachments', 'audit_events', 'budget_lines', 'campaign_leftovers', 'campaigns', 'catalog_prices', 'correction_reviews', 'cost_types', 'costs', 'counterparties', 'journal_events', 'media', 'morning_reminders', 'order_lines', 'payments', 'planned_receptions', 'purchase_orders', 'push_subscriptions', 'reception_alerts', 'refused_events', 'sale_forecasts', 'sale_receipts', 'sales', 'settlements', 'sign_in_attempts', 'site_assignments', 'sites', 'users', 'weighing_requests'].map((name) => ({ name, tenant_column: true, tenant_index: true })),
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
        'attachments.id',
        'audit_events.id',
        'audit_events.tenant_id',
        'budget_lines.id',
        'budget_lines.tenant_id',
        'campaign_leftovers.campaign_id',
        'campaign_leftovers.cost_type_id',
        'campaign_leftovers.tenant_id',
        'campaigns.id',
        'catalog_prices.id',
        'correction_reviews.correction_id',
        'correction_reviews.tenant_id',
        'cost_types.id',
        'costs.id',
        'counterparties.id',
        'morning_reminders.site_id',
        'morning_reminders.tenant_id',
        'journal_events.id',
        'journal_events.tenant_id',
        'order_lines.id',
        'payments.id',
        'planned_receptions.id',
        'push_subscriptions.device_id',
        'push_subscriptions.tenant_id',
        'purchase_orders.id',
        'refused_events.event_id',
        'refused_events.tenant_id',
        'sale_forecasts.id',
        'sale_receipts.id',
        'sales.id',
        'settlements.id',
        'sign_in_attempts.device_id',
        'sign_in_attempts.tenant_id',
        'sign_in_attempts.user_id',
        'site_assignments.site_id',
        'site_assignments.user_id',
        'sites.id',
        'tenants.id',
        'users.id',
        'weighing_requests.id',
      ]
        .map((column_name) => ({ column_name, type: 'uuid', has_default: false }))
        // A media is named by its content (M.1): its fingerprint, computed by the phone, is its key.
        .concat([
          { column_name: 'media.sha256', type: 'text', has_default: false },
          { column_name: 'media.tenant_id', type: 'uuid', has_default: false },
          // A budget line is keyed by its writing and its category, a word of the base (S.1).
          { column_name: 'budget_lines.category', type: 'cost_category', has_default: false },
          // A morning reminder is keyed by its site and the day it asks about (Y.3): once per day and per site.
          { column_name: 'morning_reminders.day', type: 'date', has_default: false },
          // A reception alert is keyed by its reception and its day (Q.15): once per reception and per day.
          { column_name: 'reception_alerts.day', type: 'date', has_default: false },
          { column_name: 'reception_alerts.reception_id', type: 'uuid', has_default: false },
          { column_name: 'reception_alerts.tenant_id', type: 'uuid', has_default: false },
        ])
        .sort((a, b) => a.column_name.localeCompare(b.column_name)),
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
      { column_name: 'cost_types.created_at', column_default: 'CURRENT_TIMESTAMP' },
      // A counterparty does not advance money for the farm until the admin says so (R.7).
      { column_name: 'counterparties.advances_expenses', column_default: 'false' },
      { column_name: 'counterparties.created_at', column_default: 'CURRENT_TIMESTAMP' },
      { column_name: 'journal_events.received_at', column_default: 'CURRENT_TIMESTAMP' },
      { column_name: 'payments.created_at', column_default: 'CURRENT_TIMESTAMP' },
      { column_name: 'purchase_orders.created_at', column_default: 'CURRENT_TIMESTAMP' },
      { column_name: 'push_subscriptions.created_at', column_default: 'CURRENT_TIMESTAMP' },
      { column_name: 'refused_events.received_at', column_default: 'CURRENT_TIMESTAMP' },
      { column_name: 'sale_receipts.created_at', column_default: 'CURRENT_TIMESTAMP' },
      { column_name: 'sales.created_at', column_default: 'CURRENT_TIMESTAMP' },
      { column_name: 'settlements.created_at', column_default: 'CURRENT_TIMESTAMP' },
      { column_name: 'sign_in_attempts.failures', column_default: '0' },
      { column_name: 'site_assignments.created_at', column_default: 'CURRENT_TIMESTAMP' },
      { column_name: 'sites.created_at', column_default: 'CURRENT_TIMESTAMP' },
      { column_name: 'sites.strict_mode', column_default: 'false' },
      { column_name: 'tenants.created_at', column_default: 'CURRENT_TIMESTAMP' },
      { column_name: 'users.created_at', column_default: 'CURRENT_TIMESTAMP' },
      { column_name: 'weighing_requests.created_at', column_default: 'CURRENT_TIMESTAMP' },
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

  // Spec: backlog N.9 — le stade d'un aliment (démarrage, croissance, finition) ne se pose que sur un aliment
  it("un stade d'aliment hors des aliments est refusé par la base", async () => {
    const type = { tenantId: TENANT_A, name: 'Poussins', behaviour: 'Variable' as const, feedStage: 'Starter' as const };
    await expect(db.superuser.costType.create({ data: { id: '00000000-0000-4000-8000-0000000000d1', category: 'Chicks', ...type } })).rejects.toThrow(/cost_types_feed_stage/);
    await expect(db.superuser.costType.create({ data: { id: '00000000-0000-4000-8000-0000000000d2', category: 'Feed', ...type } })).resolves.toMatchObject({ feedStage: 'Starter' });
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
    // Given un serveur à part, où le propriétaire existe mais pas le rôle de l'API — jamais le serveur
    // partagé du lancement : y retirer le rôle de l'API couperait les autres fichiers de test
    const alone = await new PostgreSqlContainer('postgres:16')
      .withLabels({ 'yaar.test-run': process.env['YAAR_TEST_RUN'] ?? '', 'yaar.test-run-pid': process.env['YAAR_TEST_RUN_PID'] ?? '' })
      .start();
    try {
      const sql = async (statement: string) => expect((await alone.exec(['psql', '-v', 'ON_ERROR_STOP=1', '-U', alone.getUsername(), '-d', alone.getDatabase(), '-c', statement])).exitCode).toBe(0);
      await sql("CREATE ROLE yaar LOGIN PASSWORD 'test-only-owner' NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION");
      await sql('CREATE DATABASE yaar_alone OWNER yaar');
      const url = new URL(alone.getConnectionUri());
      url.pathname = '/yaar_alone';
      url.username = 'yaar';
      url.password = 'test-only-owner';

      // When
      let failure = '';
      try {
        migrate(url.toString());
      } catch (error) {
        const { stdout, stderr } = error as { stdout?: Buffer; stderr?: Buffer };
        failure = `${String(stdout ?? '')}${String(stderr ?? '')}`;
      }

      // Then la migration a échoué en le disant, et aucun rôle n'a été créé à sa place
      expect(failure).toMatch(/yaar_app is missing/);
      const roles = await alone.exec(['psql', '-At', '-U', alone.getUsername(), '-d', alone.getDatabase(), '-c', "SELECT count(*) FROM pg_roles WHERE rolname = 'yaar_app'"]);
      expect(roles.output.trim()).toBe('0');
    } finally {
      await alone.stop();
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
