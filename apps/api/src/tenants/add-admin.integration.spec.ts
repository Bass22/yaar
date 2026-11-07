import { unwrap } from '@kit';
import { Argon2PinHasher } from '../auth/argon2-pin-hasher';
import { Pin } from '../auth/pin';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';
import { addAdmin, type AddAdminInput } from './add-admin';
import { bootstrapTenant } from './bootstrap-tenant';

// Spec: Cahier des charges — « Identité » (un élevage a au moins un admin, et pas forcément
// un seul ; un admin n'est créé que par l'éditeur, par script) ; backlog E.8. Tourne sur un
// PostgreSQL réel, sous le rôle propriétaire, comme le script.
jest.setTimeout(180_000);

const hasher = new Argon2PinHasher();
const NOW = new Date('2026-11-07T08:00:00.000Z');

describe("Ajouter un admin à un élevage, par script", () => {
  let db: TestDatabase;
  let created = 0;
  const ids = (): string => `00000000-0000-4000-8000-${String(++created).padStart(12, '0')}`;
  let tenantId = '';
  let firstAdminId = '';

  // A second admin as the founder would add them, unless said otherwise.
  const unAdmin = (overrides: Partial<AddAdminInput> = {}): AddAdminInput => ({
    tenantId,
    adminName: 'Fatou, co-gérante',
    adminPhone: '+221776543210',
    pin: '739164',
    ...overrides,
  });
  const ajoute = (input: AddAdminInput) => addAdmin(input, { prisma: db.owner, hasher, ids, now: () => NOW });

  beforeAll(async () => {
    db = await createTestDatabase();
    const farm = unwrap(
      await bootstrapTenant(
        { tenantName: 'Ferme de Keur Massar', currency: 'XOF', siteName: 'Poulailler 1', timeZone: 'Africa/Dakar', adminName: 'Bassirou', adminPhone: '+221771234567', pin: '482913' },
        { prisma: db.owner, hasher, ids, now: () => NOW },
      ),
    );
    tenantId = farm.tenantId;
    firstAdminId = farm.adminId;
  });

  afterAll(async () => {
    await db?.drop();
  });

  it("ajoute un admin à un élevage qui en a déjà un : les deux sont admins, le nouveau avec son PIN haché, sans PIN provisoire à changer", async () => {
    // When
    const result = await ajoute(unAdmin());

    // Then
    const { adminId } = unwrap(result);
    const admins = await db.owner.user.findMany({ where: { tenantId, role: 'admin' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    expect(admins.map((admin) => admin.id).sort()).toEqual([firstAdminId, adminId].sort());
    const admin = await db.owner.user.findUniqueOrThrow({ where: { id: adminId } });
    expect(admin).toMatchObject({ tenantId, phone: '+221776543210', name: 'Fatou, co-gérante', role: 'admin', provisionalPinExpiresAt: null, blockedAt: null });
    expect(admin.pinHash).not.toContain('739164');
    expect(await hasher.verify(admin.pinHash as never, unwrap(Pin('739164', 'admin')))).toBe(true);
  });

  it("l'ajout est tracé dans l'élevage : l'éditeur n'a pas de compte, l'auteur reste vide, et la trace ne contient ni PIN ni numéro", async () => {
    const { adminId } = unwrap(await ajoute(unAdmin({ adminPhone: '+221776543211', pin: '815372' })));

    const trace = await db.owner.auditEvent.findMany({ where: { subjectId: adminId } });

    expect(trace).toEqual([expect.objectContaining({ tenantId, action: 'AdminAdded', actorId: null, subjectId: adminId, siteId: null, deviceId: null, reason: null, occurredAt: NOW })]);
    expect(JSON.stringify(trace)).not.toMatch(/815372|\+22177/);
  });

  it("le premier admin, créé avec l'élevage, est tracé de même", async () => {
    const trace = await db.owner.auditEvent.findMany({ where: { subjectId: firstAdminId } });

    expect(trace).toEqual([expect.objectContaining({ tenantId, action: 'AdminAdded', actorId: null, subjectId: firstAdminId, occurredAt: NOW })]);
  });

  it("un numéro qui a déjà un compte, dans cet élevage ou un autre, est refusé, et rien n'est créé ni tracé", async () => {
    const before = { users: await db.owner.user.count(), trace: await db.owner.auditEvent.count() };

    for (const adminPhone of ['+221771234567', '+221776543210']) {
      expect(await ajoute(unAdmin({ adminPhone }))).toEqual({ ok: false, error: { kind: 'PhoneAlreadyUsed' } });
    }

    expect({ users: await db.owner.user.count(), trace: await db.owner.auditEvent.count() }).toEqual(before);
  });

  it("un élevage inconnu, ou un identifiant qui n'en est pas un, est refusé, et rien n'est créé", async () => {
    const before = await db.owner.user.count();

    for (const unknown of ['00000000-0000-4000-8000-0000000fffff', 'Ferme de Keur Massar', '']) {
      expect(await ajoute(unAdmin({ tenantId: unknown, adminPhone: '+221776543212' }))).toEqual({ ok: false, error: { kind: 'TenantNotFound' } });
    }

    expect(await db.owner.user.count()).toBe(before);
  });

  it("le PIN a six chiffres et n'est pas trop simple, le numéro est en forme internationale, le nom n'est pas vide ; un refus ne répète pas le PIN", async () => {
    const refusals = [
      [{ pin: '4829' }, { kind: 'InvalidPin', expectedDigits: 6 }],
      [{ pin: '654321' }, { kind: 'TrivialPin' }],
      [{ adminPhone: '776543213' }, { kind: 'InvalidPhone' }],
      [{ adminName: '  ' }, { kind: 'MissingName' }],
    ] as const;

    for (const [overrides, error] of refusals) {
      const result = await ajoute(unAdmin({ adminPhone: '+221776543213', ...overrides }));
      expect(result).toEqual({ ok: false, error });
      expect(JSON.stringify(result)).not.toContain('4829');
    }
    expect(await db.owner.user.count({ where: { phone: '+221776543213' } })).toBe(0);
  });
});
