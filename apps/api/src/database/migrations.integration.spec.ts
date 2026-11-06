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
    await db.owner.tenant.createMany({
      data: [
        { id: TENANT_A, name: 'Élevage A', currency: 'XOF' },
        { id: TENANT_B, name: 'Élevage B', currency: 'XOF' },
      ],
    });
    await db.owner.site.createMany({
      data: [
        { id: SITE_A, tenantId: TENANT_A, name: 'Poulailler A', timeZone: 'Africa/Dakar' },
        { id: SITE_B, tenantId: TENANT_B, name: 'Poulailler B', timeZone: 'Africa/Douala' },
      ],
    });
    await db.owner.user.createMany({
      data: [OUSMANE, AWA, MODOU].map((id, rank) => ({
        id,
        tenantId: TENANT_A,
        phone: `+22177000000${rank}`,
        name: `Gardien ${rank}`,
        role: 'collaborator' as const,
      })),
    });
  });

  afterAll(async () => {
    await db?.drop();
  });

  it("les migrations s'appliquent sur une base vide et créent les six tables", async () => {
    const tables = await db.owner.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename`;

    expect(tables.map((table) => table.tablename)).toEqual(['campaigns', 'journal_events', 'site_assignments', 'sites', 'tenants', 'users']);
  });

  it('rejouer les migrations sur une base à jour ne change rien et ne casse rien', async () => {
    expect(() => migrate(db.url)).not.toThrow();
    expect(await db.owner.site.count()).toBe(2);
  });

  it('toute table porte `tenant_id` obligatoire, avec un index qui commence par lui — sauf `tenants`', async () => {
    // Lu dans le catalogue de PostgreSQL : une table écrite à la main dans une migration y passe aussi.
    const tables = await db.owner.$queryRaw<{ name: string; tenant_column: boolean; tenant_index: boolean }[]>`
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
      ['campaigns', 'journal_events', 'site_assignments', 'sites', 'users'].map((name) => ({ name, tenant_column: true, tenant_index: true })),
    );
  });

  it("la base ne fabrique pas d'identifiant : une ligne écrite sans identifiant est refusée", async () => {
    const withoutId = db.owner.$executeRaw`INSERT INTO sites (tenant_id, name, time_zone) VALUES (${TENANT_A}::uuid, 'Sans identifiant', 'Africa/Dakar')`;

    // 23502 : PostgreSQL refuse une valeur absente dans une colonne obligatoire
    await expect(withoutId).rejects.toThrow(/Code: `23502`[\s\S]*Failing row contains \(null,/);
    expect(await db.owner.site.count({ where: { name: 'Sans identifiant' } })).toBe(0);
  });

  it('un site porte son fuseau horaire : sans lui, il ne s’enregistre pas', async () => {
    const withoutTimeZone = db.owner.$executeRaw`INSERT INTO sites (id, tenant_id, name) VALUES ('00000000-0000-4000-8000-0000000000a9'::uuid, ${TENANT_A}::uuid, 'Sans fuseau')`;

    await expect(withoutTimeZone).rejects.toThrow(/Code: `23502`/);
    expect(await db.owner.site.count({ where: { name: 'Sans fuseau' } })).toBe(0);
    expect(await db.owner.site.findUniqueOrThrow({ where: { id: SITE_B } })).toMatchObject({ timeZone: 'Africa/Douala' });
  });

  it("une ligne ne référence que des lignes de son élevage : une campagne de A ne s'attache pas au site de B", async () => {
    const campaign = { placementDay: new Date('2026-10-15') };

    await expect(
      db.owner.campaign.create({ data: { id: '00000000-0000-4000-8000-0000000000c1', tenantId: TENANT_A, siteId: SITE_B, ...campaign } }),
    ).rejects.toThrow(/Foreign key constraint/i);
    await expect(
      db.owner.campaign.create({ data: { id: '00000000-0000-4000-8000-0000000000c2', tenantId: TENANT_A, siteId: SITE_A, ...campaign } }),
    ).resolves.toMatchObject({ siteId: SITE_A, closedAt: null });
  });

  it("un collaborateur ne s'affecte pas au site d'un autre élevage", async () => {
    const acrossTenants = db.owner.siteAssignment.create({ data: { tenantId: TENANT_A, siteId: SITE_B, userId: OUSMANE, isPrimary: false } });

    await expect(acrossTenants).rejects.toThrow(/Foreign key constraint/i);
  });

  it("un site n'a qu'un titulaire, et autant de remplaçants qu'il faut", async () => {
    // Given Ousmane titulaire, Awa remplaçante
    await db.owner.siteAssignment.createMany({
      data: [
        { tenantId: TENANT_A, siteId: SITE_A, userId: OUSMANE, isPrimary: true },
        { tenantId: TENANT_A, siteId: SITE_A, userId: AWA, isPrimary: false },
      ],
    });

    // Then un second titulaire est refusé, un second remplaçant est accepté
    const secondPrimary = db.owner.siteAssignment.create({ data: { tenantId: TENANT_A, siteId: SITE_A, userId: MODOU, isPrimary: true } });
    await expect(secondPrimary).rejects.toThrow(/Unique constraint/i);
    await expect(
      db.owner.siteAssignment.create({ data: { tenantId: TENANT_A, siteId: SITE_A, userId: MODOU, isPrimary: false } }),
    ).resolves.toMatchObject({ isPrimary: false });
  });

  it('deux élevages peuvent avoir le même numéro de téléphone, pas deux comptes du même élevage', async () => {
    const samePhone = { phone: '+221770000000', name: 'Homonyme', role: 'admin' as const };

    await expect(
      db.owner.user.create({ data: { id: '00000000-0000-4000-8000-0000000000b2', tenantId: TENANT_B, ...samePhone } }),
    ).resolves.toMatchObject({ tenantId: TENANT_B });
    await expect(
      db.owner.user.create({ data: { id: '00000000-0000-4000-8000-0000000000a5', tenantId: TENANT_A, ...samePhone } }),
    ).rejects.toThrow(/Unique constraint/i);
  });
});
