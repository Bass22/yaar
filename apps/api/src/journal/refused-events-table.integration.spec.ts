import { createTestDatabase, type TestDatabase } from '../testing/test-database';

// Spec: backlog G.5 ; cahier des charges « Une déclaration refusée n'est jamais perdue »
// (décision du 2026-11-08) ; CLAUDE.md §4 règles 1 et 5. PostgreSQL réel.
jest.setTimeout(180_000);

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT = uuid(10);
const NORD = uuid(3);
const BANDE = uuid(4);
const OUSMANE = uuid(51);

describe('Le registre des déclarations refusées', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
    await db.superuser.tenant.create({ data: { id: TENANT, name: 'Ferme', currency: 'XOF' } });
    await db.superuser.site.create({ data: { id: NORD, tenantId: TENANT, name: 'Poulailler', timeZone: 'Africa/Dakar' } });
    await db.superuser.campaign.create({ data: { id: BANDE, tenantId: TENANT, siteId: NORD, placementDay: new Date('2026-10-15'), strain: 'Cobb500', plannedHeadcount: 1000, plannedDuration: 45 } });
    await db.superuser.user.create({ data: { id: OUSMANE, tenantId: TENANT, role: 'collaborator', phone: '+221770000001', name: 'Ousmane', pinHash: 'x' } });
    await db.superuser.refusedEvent.create({
      data: {
        eventId: uuid(1),
        tenantId: TENANT,
        siteId: NORD,
        campaignId: BANDE,
        authorId: OUSMANE,
        deviceId: uuid(91),
        businessDate: new Date('2026-11-01'),
        recordedAt: new Date('2026-11-05T18:30:00.000Z'),
        event: { fact: { type: 'Death', quantity: 3 } },
        refusal: { kind: 'CatchUpWindowPassed' },
      },
    });
  });

  afterAll(async () => {
    await db?.drop();
  });

  it("l'application n'y a que deux droits : lire et ajouter", async () => {
    const rows = await db.superuser.$queryRaw<{ privilege_type: string }[]>`
      SELECT privilege_type FROM information_schema.role_table_grants WHERE grantee = 'yaar_app' AND table_name = 'refused_events' ORDER BY privilege_type`;

    expect(rows.map((row) => row.privilege_type)).toEqual(['INSERT', 'SELECT']);
  });

  it('un refus gardé ne se modifie ni ne s’efface, même par un superutilisateur : le chef doit le voir tel qu’il est arrivé', async () => {
    await expect(db.superuser.$executeRaw`UPDATE refused_events SET refusal = '{"kind":"Autre"}'`).rejects.toThrow(/append-only/);
    await expect(db.superuser.$executeRaw`DELETE FROM refused_events`).rejects.toThrow(/append-only/);
    expect(await db.superuser.refusedEvent.count({ where: { eventId: uuid(1) } })).toBe(1);
  });

  it('la date de réception est posée par la base : celle qu’un client enverrait est ignorée', async () => {
    const row = await db.superuser.refusedEvent.create({
      data: {
        eventId: uuid(2),
        tenantId: TENANT,
        siteId: NORD,
        campaignId: BANDE,
        authorId: OUSMANE,
        deviceId: uuid(91),
        businessDate: new Date('2026-11-01'),
        recordedAt: new Date('2026-11-05T18:30:00.000Z'),
        receivedAt: new Date('2000-01-01T00:00:00.000Z'),
        event: {},
        refusal: { kind: 'CatchUpWindowPassed' },
      },
    });

    expect(row.receivedAt.getTime()).toBeGreaterThan(Date.parse('2026-01-01'));
  });
});
