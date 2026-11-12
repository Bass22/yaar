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
const TABLES = ['tenants', 'users', 'sites', 'site_assignments', 'campaigns', 'journal_events', 'audit_events', 'refused_events', 'counterparties', 'cost_types', 'purchase_orders', 'order_lines', 'payments', 'media', 'costs', 'settlements', 'sales', 'sale_receipts', 'weighing_requests'];

describe('Cloisonnement entre élevages', () => {
  let db: TestDatabase;
  let api: PrismaService;

  beforeAll(async () => {
    // Given deux élevages, chacun avec un site, un gardien affecté, une campagne et un événement au journal — semés par le superutilisateur, que la RLS ne lie pas
    db = await createTestDatabase();
    for (const [tenantId, siteId, suffix] of [
      [TENANT_A, SITE_A, 'a'],
      [TENANT_B, SITE_B, 'b'],
    ] as const) {
      const userId = `00000000-0000-4000-8000-0000000000${suffix}2`;
      await db.superuser.tenant.create({ data: { id: tenantId, name: `Élevage ${suffix.toUpperCase()}`, currency: 'XOF' } });
      await db.superuser.site.create({ data: { id: siteId, tenantId, name: `Poulailler ${suffix.toUpperCase()}`, timeZone: 'Africa/Dakar' } });
      await db.superuser.user.create({ data: { id: userId, tenantId, phone: `+22177000000${suffix === 'a' ? 1 : 2}`, name: 'Gardien', role: 'collaborator', pinHash: '$argon2id$v=19$m=19456,t=2,p=1$dGVzdC1vbmx5LXNhbHQ$dGVzdC1vbmx5LWRpZ2VzdC1ub3QtYS1yZWFsLXBpbg' } });
      await db.superuser.siteAssignment.create({ data: { tenantId, siteId, userId, isPrimary: true } });
      const campaignId = `00000000-0000-4000-8000-0000000000${suffix}3`;
      await db.superuser.campaign.create({ data: { id: campaignId, tenantId, siteId, placementDay: new Date('2026-10-15'), strain: 'Cobb500', plannedHeadcount: 1000, plannedDuration: 45 } });
      await db.superuser.journalEvent.create({
        data: {
          id: '00000000-0000-4000-8000-0000000000e1',
          tenantId,
          siteId,
          campaignId,
          authorId: userId,
          businessDate: new Date('2026-11-05'),
          recordedAt: new Date('2026-11-05T18:30:00.000Z'),
          deviceId: '00000000-0000-4000-8000-0000000000d1',
          type: 'Death',
          fact: { quantity: 3 },
        },
      });
      await db.superuser.counterparty.create({ data: { id: `00000000-0000-4000-8000-0000000000${suffix}9`, tenantId, kind: 'Supplier', name: 'Sedima', face: 'closed-bag' } });
      await db.superuser.costType.create({ data: { id: `00000000-0000-4000-8000-0000000000${suffix}8`, tenantId, category: 'Feed', name: 'Aliment', behaviour: 'Variable' } });
      await db.superuser.counterparty.create({ data: { id: `00000000-0000-4000-8000-0000000000${suffix}7`, tenantId, kind: 'Supplier', name: 'Fournisseur', face: 'truck' } });
      await db.superuser.purchaseOrder.create({ data: { id: `00000000-0000-4000-8000-0000000001${suffix}1`, tenantId, supplierId: `00000000-0000-4000-8000-0000000000${suffix}7`, campaignId, orderDay: new Date('2026-10-12'), currency: 'XOF' } });
      await db.superuser.orderLine.create({ data: { id: `00000000-0000-4000-8000-0000000001${suffix}2`, tenantId, orderId: `00000000-0000-4000-8000-0000000001${suffix}1`, position: 0, costTypeId: `00000000-0000-4000-8000-0000000000${suffix}8`, quantity: 20, unitPrice: 17500 } });
      await db.superuser.payment.create({ data: { id: `00000000-0000-4000-8000-0000000001${suffix}3`, tenantId, orderId: `00000000-0000-4000-8000-0000000001${suffix}1`, paidOn: new Date('2026-10-13'), amount: 1000, method: 'Wave', recordedBy: userId } });
      await db.superuser.media.create({ data: { tenantId, sha256: 'a'.repeat(64), byteSize: 10, contentType: 'image/jpeg', retentionClass: 'OperationalProof', uploadedBy: userId, deviceId: userId, uploadedAt: new Date('2026-10-13T08:00:00.000Z') } });
      await db.superuser.cost.create({ data: { tenantId, id: `00000000-0000-4000-8000-0000000001${suffix}4`, campaignId, costTypeId: `00000000-0000-4000-8000-0000000000${suffix}8`, spentOn: new Date('2026-10-13'), amount: 12500, paymentKind: 'Paid', recordedAt: new Date('2026-10-13T08:00:00.000Z'), recordedBy: userId } });
      await db.superuser.settlement.create({ data: { tenantId, id: `00000000-0000-4000-8000-0000000001${suffix}5`, counterpartyId: `00000000-0000-4000-8000-0000000000${suffix}7`, paidOn: new Date('2026-10-13'), amount: 1000, method: 'Cash', direction: 'ToCounterparty', recordedBy: userId } });
      await db.superuser.sale.create({ data: { tenantId, id: `00000000-0000-4000-8000-0000000001${suffix}6`, campaignId, buyerId: `00000000-0000-4000-8000-0000000000${suffix}7`, soldOn: new Date('2026-10-13'), birds: 1, pricingKind: 'PerBird', unitPrice: 2750, amount: 2750, recordedBy: userId } });
      await db.superuser.saleReceipt.create({ data: { tenantId, id: `00000000-0000-4000-8000-0000000001${suffix}7`, saleId: `00000000-0000-4000-8000-0000000001${suffix}6`, paidOn: new Date('2026-10-13'), amount: 2750, method: 'Cash', recordedBy: userId } });
      await db.superuser.weighingRequest.create({ data: { tenantId, id: `00000000-0000-4000-8000-0000000001${suffix}8`, campaignId, requestedFor: new Date('2026-10-13'), requestedBy: userId } });
      await db.superuser.refusedEvent.create({
        data: {
          eventId: '00000000-0000-4000-8000-0000000000e2',
          tenantId,
          siteId,
          campaignId,
          authorId: userId,
          deviceId: '00000000-0000-4000-8000-0000000000d1',
          businessDate: new Date('2026-11-01'),
          recordedAt: new Date('2026-11-05T18:30:00.000Z'),
          event: { fact: { type: 'Death', quantity: 2 } },
          refusal: { kind: 'CatchUpWindowPassed' },
        },
      });
    }
    // The API connects as the application role, never as the owner.
    api = new PrismaService({ port: 0, databaseUrl: db.appUrl, jwtSecret: 'un-secret-de-test-assez-long-pour-signer-des-jetons', mediaPath: '/data/medias' });
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
      expect(await countAll(api)).toEqual({ tenants: 0, users: 0, sites: 0, site_assignments: 0, campaigns: 0, journal_events: 0, audit_events: 0, refused_events: 0, counterparties: 0, cost_types: 0, purchase_orders: 0, order_lines: 0, payments: 0, media: 0, costs: 0, settlements: 0, sales: 0, sale_receipts: 0, weighing_requests: 0 });
    });

    it("rien ne s'écrit", async () => {
      const write = api.site.create({ data: { id: '00000000-0000-4000-8000-0000000000a8', tenantId: TENANT_A, name: 'Sans tenant', timeZone: 'Africa/Dakar' } });

      await expect(write).rejects.toThrow(/row-level security/);
    });
  });

  // Spec: backlog D.6 — le propriétaire des tables, sous lequel tournent migrations et scripts de l'éditeur, est lié par la RLS forcée
  describe('le propriétaire des tables', () => {
    it("sans élevage fixé, ne voit aucune ligne, dans aucune table — ni le journal, ni la trace — alors qu'un superutilisateur voit tout", async () => {
      expect(await countAll(db.owner)).toEqual({ tenants: 0, users: 0, sites: 0, site_assignments: 0, campaigns: 0, journal_events: 0, audit_events: 0, refused_events: 0, counterparties: 0, cost_types: 0, purchase_orders: 0, order_lines: 0, payments: 0, media: 0, costs: 0, settlements: 0, sales: 0, sale_receipts: 0, weighing_requests: 0 });
      expect((await countAll(db.superuser)).journal_events).toBe(2);
    });

    it("qui fixe un élevage ne voit que cet élevage", async () => {
      const seen = await db.owner.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.tenant_id', ${TENANT_A}, true)`;
        return countAll(tx);
      });

      expect(seen).toEqual({ tenants: 1, users: 1, sites: 1, site_assignments: 1, campaigns: 1, journal_events: 1, audit_events: 0, refused_events: 1, counterparties: 2, cost_types: 1, purchase_orders: 1, order_lines: 1, payments: 1, media: 1, costs: 1, settlements: 1, sales: 1, sale_receipts: 1, weighing_requests: 1 });
    });
  });

  describe('un élevage ne voit que lui', () => {
    it("un utilisateur de l'élevage A ne lit aucune ligne de l'élevage B, dans aucune table", async () => {
      // When chaque élevage compte ce qu'il voit, et lit ses sites
      const seenByA = await api.runInTenant(TENANT_A, (tx) => countAll(tx));
      const sitesOfA = await api.runInTenant(TENANT_A, (tx) => tx.site.findMany());
      const sitesOfB = await api.runInTenant(TENANT_B, (tx) => tx.site.findMany());

      // Then une ligne par table, la sienne
      expect(seenByA).toEqual({ tenants: 1, users: 1, sites: 1, site_assignments: 1, campaigns: 1, journal_events: 1, audit_events: 0, refused_events: 1, counterparties: 2, cost_types: 1, purchase_orders: 1, order_lines: 1, payments: 1, media: 1, costs: 1, settlements: 1, sales: 1, sale_receipts: 1, weighing_requests: 1 });
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
      expect(await db.superuser.site.count({ where: { name: 'Intrus' } })).toBe(0);
    });

    it("un utilisateur de A ne modifie pas une ligne de B : elle n'existe pas pour lui", async () => {
      const updated = await api.runInTenant(TENANT_A, (tx) => tx.site.updateMany({ where: { id: SITE_B }, data: { name: 'Renommé par A' } }));

      expect(updated.count).toBe(0);
      expect(await db.superuser.site.findUniqueOrThrow({ where: { id: SITE_B } })).toMatchObject({ name: 'Poulailler B' });
    });

    it("un utilisateur de A ne retire pas une affectation de B : elle n'existe pas pour lui", async () => {
      const removed = await api.runInTenant(TENANT_A, (tx) => tx.siteAssignment.deleteMany({ where: { siteId: SITE_B } }));

      expect(removed.count).toBe(0);
      expect(await db.superuser.siteAssignment.count({ where: { siteId: SITE_B } })).toBe(1);
    });

    it("un utilisateur de A n'écrit pas une ligne au nom de B, même sans relire ce qu'il écrit", async () => {
      // When une écriture brute, sans RETURNING : seule la règle d'écriture de la politique peut la refuser
      const write = api.runInTenant(TENANT_A, (tx) =>
        tx.$executeRaw`INSERT INTO sites (id, tenant_id, name, time_zone) VALUES ('00000000-0000-4000-8000-0000000000b9'::uuid, ${TENANT_B}::uuid, 'Intrus discret', 'Africa/Dakar')`,
      );

      await expect(write).rejects.toThrow(/row-level security/);
      expect(await db.superuser.site.count({ where: { name: 'Intrus discret' } })).toBe(0);
    });

    it("un utilisateur de A ne fait pas passer une de ses lignes chez B", async () => {
      // Given un site de A dont rien ne dépend : aucune clé étrangère ne le retient
      const lonely = '00000000-0000-4000-8000-0000000000a4';
      await db.superuser.site.create({ data: { id: lonely, tenantId: TENANT_A, name: 'Site sans attache', timeZone: 'Africa/Dakar' } });

      // When
      const moved = api.runInTenant(TENANT_A, (tx) => tx.$executeRaw`UPDATE sites SET tenant_id = ${TENANT_B}::uuid WHERE id = ${lonely}::uuid`);

      // Then
      await expect(moved).rejects.toThrow(/row-level security/);
      expect(await db.superuser.site.findUniqueOrThrow({ where: { id: lonely } })).toMatchObject({ tenantId: TENANT_A });
      await db.superuser.site.delete({ where: { id: lonely } });
    });

    it("même un superutilisateur ne déplace pas un site qui a des lignes attachées : rien ne se propage", async () => {
      const moved = db.superuser.$executeRaw`UPDATE sites SET tenant_id = ${TENANT_B}::uuid WHERE id = ${SITE_A}::uuid`;

      await expect(moved).rejects.toThrow(/23503|23001|foreign key/i);
      expect(await db.superuser.campaign.count({ where: { tenantId: TENANT_A } })).toBe(1);
    });

    it("un élevage écrit chez lui", async () => {
      const created = await api.runInTenant(TENANT_A, (tx) =>
        tx.site.create({ data: { id: '00000000-0000-4000-8000-0000000000a7', tenantId: TENANT_A, name: 'Second poulailler', timeZone: 'Africa/Dakar' } }),
      );

      expect(created).toMatchObject({ tenantId: TENANT_A, name: 'Second poulailler' });
      await db.superuser.site.delete({ where: { id: created.id } });
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
      expect(await db.superuser.user.findFirstOrThrow({ where: { phone: '+221770000002' } })).toMatchObject({ name: 'Gardien' });
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
      expect(await db.superuser.site.count({ where: { tenantId: TENANT_A } })).toBe(1);
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
      expect(await db.superuser.site.count({ where: { name: 'À moitié écrit' } })).toBe(0);
    });
  });

  describe("le rôle de l'application", () => {
    it("n'est ni superutilisateur, ni dispensé de RLS, ni propriétaire d'une table, et ne crée ni rôle ni base", async () => {
      const [role] = await api.$queryRaw<Record<string, boolean>[]>`
        SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = current_user`;
      const owned = await db.superuser.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE tableowner = 'yaar_app'`;

      expect(role).toEqual({ rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false });
      expect(owned).toEqual([]);
    });

    it('toute table a sa RLS activée et forcée, avec une politique — une table ajoutée sans elle fait échouer ce test', async () => {
      const tables = await db.superuser.$queryRaw<{ name: string; enabled: boolean; forced: boolean; policies: number }[]>`
        SELECT t.relname AS name, t.relrowsecurity AS enabled, t.relforcerowsecurity AS forced,
               (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = t.oid) AS policies
          FROM pg_class t JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'public' AND t.relkind = 'r' AND t.relname <> '_prisma_migrations'
         ORDER BY t.relname`;

      // `users` has a second policy: the one that lets a sign-in find its row by phone number.
      expect(tables).toEqual([...TABLES].sort().map((name) => ({ name, enabled: true, forced: true, policies: name === 'users' ? 2 : 1 })));
    });

    it("n'a que les droits accordés table par table : lire et écrire, jamais vider, ne supprimer qu'une affectation à un site, et seulement lire son élevage", async () => {
      // Lu dans le catalogue : un droit accordé en trop par une migration fait échouer ce test.
      const grants = await db.superuser.$queryRaw<{ table_name: string; privileges: string }[]>`
        SELECT table_name::text, string_agg(privilege_type::text, ',' ORDER BY privilege_type) AS privileges
          FROM information_schema.role_table_grants
         WHERE grantee = 'yaar_app' AND table_schema = 'public'
         GROUP BY table_name ORDER BY table_name`;

      expect(grants).toEqual([
        { table_name: 'audit_events', privileges: 'INSERT,SELECT' },
        { table_name: 'campaigns', privileges: 'INSERT,SELECT,UPDATE' },
        // Archived, never deleted (N.2).
        { table_name: 'cost_types', privileges: 'INSERT,SELECT,UPDATE' },
        // A money entry: corrected by another row, never updated nor deleted (P.2).
        { table_name: 'costs', privileges: 'INSERT,SELECT' },
        // Archived, never deleted (N.3).
        { table_name: 'counterparties', privileges: 'INSERT,SELECT,UPDATE' },
        { table_name: 'journal_events', privileges: 'INSERT,SELECT' },
        // A draft's lines are rewritten whole (Q.4).
        // Added once; the file is never removed (M.1).
        { table_name: 'media', privileges: 'INSERT,SELECT' },
        { table_name: 'order_lines', privileges: 'DELETE,INSERT,SELECT' },
        // A money entry: written once, never updated nor deleted (Q.9).
        { table_name: 'payments', privileges: 'INSERT,SELECT' },
        // Closed, never deleted (Q.4).
        { table_name: 'purchase_orders', privileges: 'INSERT,SELECT,UPDATE' },
        { table_name: 'refused_events', privileges: 'INSERT,SELECT' },
        // Money entries: added once, never updated nor deleted (W.1).
        { table_name: 'sale_receipts', privileges: 'INSERT,SELECT' },
        { table_name: 'sales', privileges: 'INSERT,SELECT' },
        // A money entry: added once, never updated nor deleted (R.2).
        { table_name: 'settlements', privileges: 'INSERT,SELECT' },
        // Removing a collaborator from a site erases the assignment; the audit trail keeps it (E.7).
        { table_name: 'site_assignments', privileges: 'DELETE,INSERT,SELECT,UPDATE' },
        { table_name: 'sites', privileges: 'INSERT,SELECT,UPDATE' },
        { table_name: 'tenants', privileges: 'SELECT' },
        { table_name: 'users', privileges: 'INSERT,SELECT,UPDATE' },
        // Added once; what answers it is read from the journal (T.2).
        { table_name: 'weighing_requests', privileges: 'INSERT,SELECT' },
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
      expect(await db.superuser.site.count()).toBe(2);
      expect(await db.superuser.tenant.count()).toBe(2);
    });
  });
});
