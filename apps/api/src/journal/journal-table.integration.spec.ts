import { unwrap } from '@kit';
import { TenantId } from '@domain/journal';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';

// Spec: backlog D.3 — la table du journal n'accepte que des ajouts ; CLAUDE.md §4 règles 1
// (journal immuable) et 2 (UUID du client, idempotence, date de saisie et date de réception).
// Tourne sur un PostgreSQL réel : le refus vient de la base, pas seulement du code.
// Generous: the first run pulls the PostgreSQL image, and every worker boots a container.
jest.setTimeout(180_000);

const TENANT_A = unwrap(TenantId('00000000-0000-4000-8000-00000000000a'));
const TENANT_B = unwrap(TenantId('00000000-0000-4000-8000-00000000000b'));
const EVENT = '00000000-0000-4000-8000-0000000000e1';
const TELEPHONE = '00000000-0000-4000-8000-0000000000d1';

const scoped = (tenantId: TenantId) => {
  const suffix = tenantId === TENANT_A ? 'a' : 'b';
  return {
    tenantId,
    siteId: `00000000-0000-4000-8000-0000000000${suffix}1`,
    authorId: `00000000-0000-4000-8000-0000000000${suffix}2`,
    campaignId: `00000000-0000-4000-8000-0000000000${suffix}3`,
  };
};

// Written on the phone on November 5th at 18:30, for that same day.
const signe = (tenantId: TenantId, id: string) => ({
  ...scoped(tenantId),
  id,
  businessDate: new Date('2026-11-05'),
  recordedAt: new Date('2026-11-05T18:30:00.000Z'),
  deviceId: TELEPHONE,
});

const troisMorts = (tenantId: TenantId, id = EVENT) => ({ ...signe(tenantId, id), type: 'Death' as const, fact: { quantity: 3 } });

describe('Table du journal', () => {
  let db: TestDatabase;
  let api: PrismaService;

  beforeAll(async () => {
    // Given deux élevages, chacun avec son site, son gardien et sa campagne
    db = await createTestDatabase();
    for (const tenantId of [TENANT_A, TENANT_B]) {
      const { siteId, authorId, campaignId } = scoped(tenantId);
      await db.superuser.tenant.create({ data: { id: tenantId, name: 'Élevage', currency: 'XOF' } });
      await db.superuser.site.create({ data: { id: siteId, tenantId, name: 'Poulailler', timeZone: 'Africa/Dakar' } });
      await db.superuser.user.create({ data: { id: authorId, tenantId, phone: `+22177000000${tenantId === TENANT_A ? 1 : 2}`, name: 'Ousmane', role: 'collaborator', pinHash: '$argon2id$v=19$m=19456,t=2,p=1$dGVzdC1vbmx5LXNhbHQ$dGVzdC1vbmx5LWRpZ2VzdC1ub3QtYS1yZWFsLXBpbg' } });
      await db.superuser.campaign.create({ data: { id: campaignId, tenantId, siteId, placementDay: new Date('2026-10-15'), strain: 'Cobb500', plannedHeadcount: 1000, plannedDuration: 45 } });
    }
    api = new PrismaService({ port: 0, databaseUrl: db.appUrl, jwtSecret: 'un-secret-de-test-assez-long-pour-signer-des-jetons', mediaPath: '/data/medias', vapidPublicKey: null });
    // And trois morts déjà au journal de chaque élevage, sous le même identifiant
    await api.runInTenant(TENANT_A, (tx) => tx.journalEvent.create({ data: troisMorts(TENANT_A) }));
    await api.runInTenant(TENANT_B, (tx) => tx.journalEvent.create({ data: troisMorts(TENANT_B) }));
  });

  afterAll(async () => {
    await api?.$disconnect();
    await db?.drop();
  });

  const stored = () => db.superuser.journalEvent.findUniqueOrThrow({ where: { tenantId_id: { tenantId: TENANT_A, id: EVENT } } });

  describe('un ajout', () => {
    it("un événement s'insère avec l'identifiant créé sur l'appareil, et se relit tel qu'il a été écrit", async () => {
      expect(await stored()).toMatchObject({
        ...scoped(TENANT_A),
        id: EVENT,
        businessDate: new Date('2026-11-05'),
        recordedAt: new Date('2026-11-05T18:30:00.000Z'),
        type: 'Death',
        fact: { quantity: 3 },
        corrects: null,
        retracts: null,
      });
    });

    it("l'identifiant est unique par élevage : le même sert dans deux élevages sans se gêner", async () => {
      expect(await db.superuser.journalEvent.count({ where: { id: EVENT } })).toBe(2);
    });

    it("le même identifiant inséré deux fois dans le même élevage ne crée qu'une ligne, et la première reste", async () => {
      // When le même événement revient, puis un autre contenu sous le même identifiant
      const replayed = api.runInTenant(TENANT_A, (tx) => tx.journalEvent.create({ data: troisMorts(TENANT_A) }));

      // Then la base refuse le doublon ; ignoré, il ne change rien
      await expect(replayed).rejects.toThrow(/Unique constraint/i);
      const ignored = await api.runInTenant(TENANT_A, (tx) =>
        tx.journalEvent.createMany({ data: [{ ...troisMorts(TENANT_A), fact: { quantity: 9 } }], skipDuplicates: true }),
      );
      expect(ignored.count).toBe(0);
      expect(await db.superuser.journalEvent.count({ where: { tenantId: TENANT_A, id: EVENT } })).toBe(1);
      expect(await stored()).toMatchObject({ fact: { quantity: 3 } });
    });

    it("un type hors de la liste fermée n'entre pas dans la table", async () => {
      const sale = api.runInTenant(TENANT_A, (tx) =>
        tx.$executeRaw`INSERT INTO journal_events (tenant_id, id, site_id, campaign_id, author_id, business_date, recorded_at, device_id, type, fact)
                       SELECT tenant_id, '00000000-0000-4000-8000-0000000000e9'::uuid, site_id, campaign_id, author_id, business_date, recorded_at, device_id, 'Sale', fact
                         FROM journal_events WHERE id = ${EVENT}::uuid`,
      );

      await expect(sale).rejects.toThrow(/journal_event_type|22P02|invalid input value/i);
    });
  });

  // Spec: backlog F.2 ; CLAUDE.md §4 règle 14 (depuis quel appareil) — réserve R-8
  describe("l'appareil", () => {
    it("un événement garde l'appareil qui l'a écrit : sans lui, il n'entre pas dans la table", async () => {
      const withoutDevice = api.runInTenant(TENANT_A, (tx) =>
        tx.$executeRaw`INSERT INTO journal_events (tenant_id, id, site_id, campaign_id, author_id, business_date, recorded_at, type, fact)
                       SELECT tenant_id, '00000000-0000-4000-8000-0000000000e8'::uuid, site_id, campaign_id, author_id, business_date, recorded_at, type, fact
                         FROM journal_events WHERE id = ${EVENT}::uuid`,
      );

      await expect(withoutDevice).rejects.toThrow(/23502|device_id/);
      expect(await db.superuser.journalEvent.findUniqueOrThrow({ where: { tenantId_id: { tenantId: TENANT_A, id: EVENT } } })).toMatchObject({ deviceId: TELEPHONE });
    });
  });

  describe('deux dates', () => {
    it("la date de réception est posée par la base : celle qu'un client enverrait est ignorée", async () => {
      // Given un événement envoyé avec une date de réception de 2020
      const before = Date.now();
      const id = '00000000-0000-4000-8000-0000000000e2';
      await api.runInTenant(TENANT_A, (tx) => tx.journalEvent.create({ data: { ...troisMorts(TENANT_A, id), receivedAt: new Date('2020-01-01T00:00:00.000Z') } }));

      // When
      const event = await db.superuser.journalEvent.findUniqueOrThrow({ where: { tenantId_id: { tenantId: TENANT_A, id } } });

      // Then la réception est de maintenant, et la date de saisie reste celle du téléphone
      expect(event.receivedAt.getTime()).toBeGreaterThanOrEqual(before - 5_000);
      expect(event.receivedAt.getTime()).toBeLessThanOrEqual(Date.now() + 5_000);
      expect(event.recordedAt).toEqual(new Date('2026-11-05T18:30:00.000Z'));
    });
  });

  describe('ni modification, ni suppression', () => {
    const unchanged = async () => expect(await stored()).toMatchObject({ fact: { quantity: 3 }, recordedAt: new Date('2026-11-05T18:30:00.000Z') });

    it("une mise à jour est refusée à l'application : elle n'en a pas le droit", async () => {
      const update = api.runInTenant(TENANT_A, (tx) => tx.journalEvent.updateMany({ where: { id: EVENT }, data: { fact: { quantity: 1 } } }));

      await expect(update).rejects.toThrow(/permission denied|42501/);
      await unchanged();
    });

    it('une mise à jour est refusée même à un superutilisateur — donc au propriétaire, qui a moins de droits —, colonne par colonne', async () => {
      const updates = [
        () => db.superuser.$executeRaw`UPDATE journal_events SET fact = '{"quantity": 1}' WHERE id = ${EVENT}::uuid`,
        () => db.superuser.$executeRaw`UPDATE journal_events SET received_at = now() WHERE id = ${EVENT}::uuid`,
        () => db.superuser.$executeRaw`UPDATE journal_events SET recorded_at = now() WHERE id = ${EVENT}::uuid`,
      ];

      for (const update of updates) {
        await expect(update()).rejects.toThrow(/append-only/);
      }
      await unchanged();
    });

    it("une suppression est refusée à l'application, et même à un superutilisateur", async () => {
      const byTheApi = api.runInTenant(TENANT_A, (tx) => tx.journalEvent.deleteMany({ where: { id: EVENT } }));
      const byTheOwner = db.superuser.$executeRaw`DELETE FROM journal_events WHERE id = ${EVENT}::uuid`;

      await expect(byTheApi).rejects.toThrow(/permission denied|42501/);
      await expect(byTheOwner).rejects.toThrow(/append-only/);
      await unchanged();
    });

    it('vider la table est refusé, même à un superutilisateur', async () => {
      // CASCADE: the « Vu » of the corrections (Y.2b) point at the journal; even emptying them along is refused by the journal's trigger.
      await expect(db.superuser.$executeRawUnsafe('TRUNCATE journal_events CASCADE')).rejects.toThrow(/append-only/);
      await unchanged();
    });

    it("l'application n'a que deux droits sur le journal : lire et ajouter", async () => {
      const [grants] = await db.superuser.$queryRaw<{ privileges: string }[]>`
        SELECT string_agg(privilege_type::text, ',' ORDER BY privilege_type) AS privileges
          FROM information_schema.role_table_grants
         WHERE grantee = 'yaar_app' AND table_name = 'journal_events'`;

      expect(grants).toEqual({ privileges: 'INSERT,SELECT' });
    });
  });

  describe('corrections et annulations', () => {
    const counter = (id: string, corrects: string) => ({ ...troisMorts(TENANT_A, id), fact: { quantity: 2 }, corrects });
    const retraction = (id: string, retracts: string) => ({ ...signe(TENANT_A, id), retracts });

    it('une contre-déclaration et une annulation nomment un événement du journal de leur élevage', async () => {
      await api.runInTenant(TENANT_A, async (tx) => {
        await tx.journalEvent.create({ data: counter('00000000-0000-4000-8000-0000000000c1', EVENT) });
        await tx.journalEvent.create({ data: retraction('00000000-0000-4000-8000-0000000000c2', EVENT) });
      });

      expect(await db.superuser.journalEvent.count({ where: { tenantId: TENANT_A, OR: [{ corrects: EVENT }, { retracts: EVENT }] } })).toBe(2);
    });

    it("nommer un événement qui n'est pas au journal de l'élevage est refusé", async () => {
      const unknown = '00000000-0000-4000-8000-0000000000ff';
      const attempts = [
        () => api.runInTenant(TENANT_A, (tx) => tx.journalEvent.create({ data: counter('00000000-0000-4000-8000-0000000000c3', unknown) })),
        () => api.runInTenant(TENANT_A, (tx) => tx.journalEvent.create({ data: retraction('00000000-0000-4000-8000-0000000000c4', unknown) })),
      ];

      for (const attempt of attempts) {
        await expect(attempt()).rejects.toThrow(/Foreign key constraint/i);
      }
    });

    it("un événement ne se nomme pas lui-même", async () => {
      const itself = '00000000-0000-4000-8000-0000000000c5';

      await expect(api.runInTenant(TENANT_A, (tx) => tx.journalEvent.create({ data: counter(itself, itself) }))).rejects.toThrow(
        /journal_events_names_another_event|check constraint|23514|Foreign key/i,
      );
    });

    it("une annulation ne porte aucun fait ; tout autre événement porte son type et son fait", async () => {
      const shapes: Prisma.JournalEventUncheckedCreateInput[] = [
        { ...retraction('00000000-0000-4000-8000-0000000000c6', EVENT), type: 'Death', fact: { quantity: 3 } },
        { ...retraction('00000000-0000-4000-8000-0000000000c7', EVENT), corrects: EVENT },
        { ...troisMorts(TENANT_A, '00000000-0000-4000-8000-0000000000c8'), fact: Prisma.DbNull },
        { ...retraction('00000000-0000-4000-8000-0000000000c9', EVENT), retracts: null },
      ];

      for (const data of shapes) {
        await expect(api.runInTenant(TENANT_A, (tx) => tx.journalEvent.create({ data }))).rejects.toThrow(/journal_events_shape|check constraint|23514/i);
      }
    });
  });
});
