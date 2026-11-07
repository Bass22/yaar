import { unwrap } from '@kit';
import { Argon2PinHasher } from '../auth/argon2-pin-hasher';
import { Pin } from '../auth/pin';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';
import { bootstrapTenant, type BootstrapInput } from './bootstrap-tenant';

// Spec: Cahier des charges — « Onboarding assisté » (les élevages sont créés à la main en V1,
// jamais par inscription) ; backlog D.4. Tourne sur un PostgreSQL réel, sous le rôle
// propriétaire : le seul qui peut créer un élevage (D.2).
jest.setTimeout(180_000);

const hasher = new Argon2PinHasher();

// A farm as the founder would create it at onboarding, unless said otherwise.
const unElevage = (overrides: Partial<BootstrapInput> = {}): BootstrapInput => ({
  tenantName: 'Ferme de Keur Massar',
  currency: 'XOF',
  siteName: 'Poulailler 1',
  timeZone: 'Africa/Dakar',
  adminName: 'Bassirou',
  adminPhone: '+221771234567',
  pin: '482913',
  ...overrides,
});

describe("Amorçage d'un élevage", () => {
  let db: TestDatabase;
  let created = 0;
  const ids = (): string => `00000000-0000-4000-8000-${String(++created).padStart(12, '0')}`;
  const amorce = (input: BootstrapInput) => bootstrapTenant(input, { prisma: db.owner, hasher, ids, now: () => new Date() });

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    await db?.drop();
  });

  // Spec: backlog D.6
  it("tourne sous le propriétaire des tables, qui n'est pas superutilisateur et que la RLS lie", async () => {
    const [role] = await db.owner.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;

    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it("crée l'élevage, son premier site et son premier admin, avec le PIN haché", async () => {
    // When
    const result = await amorce(unElevage());

    // Then les trois existent, liés entre eux, et l'empreinte reconnaît le PIN sans le contenir
    expect(result.ok).toBe(true);
    const { tenantId, siteId, adminId } = unwrap(result);
    const tenant = await db.superuser.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const site = await db.superuser.site.findUniqueOrThrow({ where: { id: siteId } });
    const admin = await db.superuser.user.findUniqueOrThrow({ where: { id: adminId } });
    expect(tenant).toMatchObject({ name: 'Ferme de Keur Massar', currency: 'XOF' });
    expect(site).toMatchObject({ tenantId, name: 'Poulailler 1', timeZone: 'Africa/Dakar', strictMode: false });
    expect(admin).toMatchObject({ tenantId, phone: '+221771234567', name: 'Bassirou', role: 'admin' });
    expect(admin.pinHash).toMatch(/^\$argon2id\$/);
    expect(admin.pinHash).not.toContain('482913');
    expect(await hasher.verify(admin.pinHash as never, unwrap(Pin('482913', 'admin')))).toBe(true);
  });

  it("relancé avec le même numéro, il refuse au lieu de créer un doublon — même pour un autre élevage", async () => {
    // Given un élevage déjà amorcé avec ce numéro
    const before = { tenants: await db.superuser.tenant.count(), users: await db.superuser.user.count() };

    // When
    const again = await amorce(unElevage({ tenantName: 'Une autre ferme' }));

    // Then
    expect(again).toEqual({ ok: false, error: { kind: 'PhoneAlreadyUsed' } });
    expect({ tenants: await db.superuser.tenant.count(), users: await db.superuser.user.count() }).toEqual(before);
  });

  it("le fuseau du site est vérifié par le domaine : un nom inconnu est refusé, et rien n'est créé", async () => {
    const before = await db.superuser.tenant.count();

    for (const timeZone of ['Dakar', 'Africa/Nulle-Part', 'UTC+0', '']) {
      expect(await amorce(unElevage({ timeZone, adminPhone: '+221770000011' }))).toEqual({ ok: false, error: { kind: 'InvalidTimeZone' } });
    }
    expect(await db.superuser.tenant.count()).toBe(before);
  });

  it("le PIN de l'admin a six chiffres et n'est pas trop simple ; un refus ne le répète pas", async () => {
    const refusals = [
      ['4829', { kind: 'InvalidPin', expectedDigits: 6 }],
      ['48291a', { kind: 'InvalidPin', expectedDigits: 6 }],
      ['123456', { kind: 'TrivialPin' }],
      ['000000', { kind: 'TrivialPin' }],
    ] as const;

    for (const [pin, error] of refusals) {
      const result = await amorce(unElevage({ pin, adminPhone: '+221770000012' }));
      expect(result).toEqual({ ok: false, error });
      expect(JSON.stringify(result)).not.toContain(pin);
    }
  });

  it("le numéro de téléphone est écrit en forme internationale ; la devise est un code à trois lettres", async () => {
    for (const adminPhone of ['771234567', '00221771234567', '+221 77 123 45 67', '+0', '']) {
      expect(await amorce(unElevage({ adminPhone }))).toEqual({ ok: false, error: { kind: 'InvalidPhone' } });
    }
    for (const currency of ['FCFA', 'xof', 'XO', '', 'XOFF']) {
      expect(await amorce(unElevage({ currency, adminPhone: '+221770000013' }))).toEqual({ ok: false, error: { kind: 'InvalidCurrency' } });
    }
  });

  it("un nom vide — élevage, site ou admin — est refusé", async () => {
    for (const overrides of [{ tenantName: ' ' }, { siteName: '' }, { adminName: '  ' }]) {
      expect(await amorce(unElevage({ ...overrides, adminPhone: '+221770000014' }))).toEqual({ ok: false, error: { kind: 'MissingName' } });
    }
  });

  it("si l'écriture échoue en route, rien ne reste : l'élevage, le site et l'admin s'écrivent ensemble ou pas du tout", async () => {
    // Given un identifiant de site déjà pris, que le script ne saura pas écrire
    const before = { tenants: await db.superuser.tenant.count(), sites: await db.superuser.site.count() };
    const existingSite = (await db.superuser.site.findFirstOrThrow()).id;
    const clashing = [ids(), existingSite, ids()];

    // When
    const result = bootstrapTenant(unElevage({ adminPhone: '+221770000015' }), { prisma: db.owner, hasher, ids: () => clashing.shift() ?? ids(), now: () => new Date() });

    // Then
    await expect(result).rejects.toThrow(/Unique constraint/i);
    expect({ tenants: await db.superuser.tenant.count(), sites: await db.superuser.site.count() }).toEqual(before);
  });
});
