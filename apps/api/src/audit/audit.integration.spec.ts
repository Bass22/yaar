import { Controller, Get, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { unwrap, type Clock } from '@kit';
import { Instant, TenantId } from '@domain/journal';
import { AppModule } from '../app.module';
import { issueAccessToken } from '../auth/access-token';
import { Argon2PinHasher } from '../auth/argon2-pin-hasher';
import { CLOCK } from '../auth/auth.module';
import { Pin } from '../auth/pin';
import { APP_CONFIG } from '../config/app-config';
import { configureApp } from '../create-app';
import { PrismaService } from '../database/prisma.service';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';

// Spec: Archi §6 « Audit » ; CLAUDE.md §4 règle 14 (toute action sensible est journalisée :
// qui, quoi, quand, depuis quel appareil) ; backlog E.6. PostgreSQL réel, serveur HTTP.
jest.setTimeout(180_000);

const SECRET = 'un-secret-de-test-assez-long-pour-signer-des-jetons';
const TENANT_A = '00000000-0000-4000-8000-00000000000a';
const LE_GERANT = '00000000-0000-4000-8000-000000000054';
const OUSMANE = '00000000-0000-4000-8000-000000000051';
const AWA = '00000000-0000-4000-8000-000000000052';
const TELEPHONE_DU_GARDIEN = '00000000-0000-4000-8000-0000000000d1';
const ORDINATEUR_DU_GERANT = '00000000-0000-4000-8000-0000000000d9';

@Controller('probe')
class ProbeController {
  @Get()
  ping(): { ok: true } {
    return { ok: true };
  }
}

describe('Trace des actions sensibles', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let origin: string;
  let now = Date.parse('2026-11-07T08:00:00.000Z');
  const clock: Clock = { now: () => new Date(now) };
  const gerant = () => issueAccessToken({ sub: LE_GERANT, tenant: TENANT_A, role: 'admin', device: ORDINATEUR_DU_GERANT }, unwrap(Instant(new Date(now).toISOString())), SECRET);
  const post = (path: string, body: unknown, token?: string) =>
    fetch(`${origin}/api/v1/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }) }, body: JSON.stringify(body) });
  const signIn = (phone: string, pin: string) => post('auth/sign-in', { phone, pin, deviceId: TELEPHONE_DU_GARDIEN });
  const trace = () =>
    db.superuser.auditEvent.findMany({
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      select: { action: true, actorId: true, subjectId: true, deviceId: true, reason: true, occurredAt: true, tenantId: true },
    });
  const tick = () => {
    now += 1_000;
  };

  beforeAll(async () => {
    db = await createTestDatabase();
    await db.superuser.tenant.create({ data: { id: TENANT_A, name: 'Ferme', currency: 'XOF' } });
    const hasher = new Argon2PinHasher();
    await db.superuser.user.createMany({
      data: [
        { id: LE_GERANT, tenantId: TENANT_A, phone: '+221770000054', name: 'Le gérant', role: 'admin', pinHash: await hasher.hash(unwrap(Pin('482913', 'admin'))) },
        { id: OUSMANE, tenantId: TENANT_A, phone: '+221770000051', name: 'Ousmane', role: 'collaborator', pinHash: await hasher.hash(unwrap(Pin('7351', 'collaborator'))) },
      ],
    });
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

  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });

  let provisionalPin = '';

  describe('les connexions', () => {
    it("une connexion ratée puis une réussie sont tracées, avec le compte, l'appareil et l'instant", async () => {
      await signIn('+221770000051', '5938');
      tick();
      await signIn('+221770000051', '7351');

      expect(await trace()).toEqual([
        { tenantId: TENANT_A, action: 'SignInFailed', actorId: OUSMANE, subjectId: OUSMANE, deviceId: TELEPHONE_DU_GARDIEN, reason: 'InvalidCredentials', occurredAt: new Date('2026-11-07T08:00:00.000Z') },
        { tenantId: TENANT_A, action: 'SignInSucceeded', actorId: OUSMANE, subjectId: OUSMANE, deviceId: TELEPHONE_DU_GARDIEN, reason: null, occurredAt: new Date('2026-11-07T08:00:01.000Z') },
      ]);
    });

    it("un numéro inconnu ne laisse aucune trace : il n'appartient à aucun élevage", async () => {
      const before = (await trace()).length;

      await signIn('+221770000099', '7351');

      expect(await trace()).toHaveLength(before);
    });

    it("une connexion refusée pendant l'attente est tracée comme refusée, avec la raison", async () => {
      tick();
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await signIn('+221770000051', '5938');
      }
      await signIn('+221770000051', '7351');

      // Same instant for all four: the order of the trail is not what is tested
      const refused = (await trace()).filter((entry) => entry.action === 'SignInRefused');
      expect(refused).toEqual([expect.objectContaining({ subjectId: OUSMANE, deviceId: TELEPHONE_DU_GARDIEN, reason: 'TooManyAttempts' })]);
      now += 3_600_000;
    });
  });

  describe("les actions de l'admin", () => {
    it("créer un compte, le bloquer, le débloquer, le déconnecter partout, remplacer son PIN : tout est tracé avec l'admin et son appareil", async () => {
      tick();
      const created = (await (await post('users', { id: AWA, phone: '+221770000052', name: 'Awa' }, gerant())).json()) as { provisionalPin: string };
      provisionalPin = created.provisionalPin;
      for (const action of ['block', 'unblock', 'sign-out-everywhere', 'reset-pin']) {
        tick();
        expect((await post(`users/${OUSMANE}/${action}`, {}, gerant())).status).toBeLessThan(300);
      }

      const byTheAdmin = (await trace()).filter((entry) => entry.actorId === LE_GERANT);
      expect(byTheAdmin.map(({ action, subjectId, deviceId }) => ({ action, subjectId, deviceId }))).toEqual([
        { action: 'AccountCreated', subjectId: AWA, deviceId: ORDINATEUR_DU_GERANT },
        { action: 'AccountBlocked', subjectId: OUSMANE, deviceId: ORDINATEUR_DU_GERANT },
        { action: 'AccountUnblocked', subjectId: OUSMANE, deviceId: ORDINATEUR_DU_GERANT },
        { action: 'SignedOutEverywhere', subjectId: OUSMANE, deviceId: ORDINATEUR_DU_GERANT },
        { action: 'PinReset', subjectId: OUSMANE, deviceId: ORDINATEUR_DU_GERANT },
      ]);
    });

    it("le premier choix du PIN est tracé, par le collaborateur lui-même", async () => {
      tick();
      expect((await post('auth/choose-pin', { phone: '+221770000052', provisionalPin, newPin: '6284', deviceId: TELEPHONE_DU_GARDIEN })).status).toBe(200);

      expect((await trace()).find((entry) => entry.action === 'PinChosen')).toMatchObject({ action: 'PinChosen', actorId: AWA, subjectId: AWA, deviceId: TELEPHONE_DU_GARDIEN });
    });

    it("une action refusée ne laisse pas de trace d'une action faite", async () => {
      const before = (await trace()).length;

      expect((await post(`users/${LE_GERANT}/block`, {}, gerant())).status).toBe(409);

      expect(await trace()).toHaveLength(before);
    });
  });

  describe('la trace elle-même', () => {
    it("aucune entrée ne contient de PIN, de jeton ni de numéro de téléphone", async () => {
      const all = JSON.stringify(await db.superuser.auditEvent.findMany());

      // The PINs typed in this file, the provisional one, any phone number, any token
      for (const secret of ['7351', '6284', '5938', provisionalPin, '+22177', 'eyJ']) {
        expect(all).not.toContain(secret);
      }
    });

    it("une entrée ne se modifie ni ne se supprime : ni par l'application, ni même par un superutilisateur", async () => {
      const api = new PrismaService({ port: 0, databaseUrl: db.appUrl, jwtSecret: SECRET });
      try {
        await expect(api.runInTenant(unwrap(TenantId(TENANT_A)), (tx) => tx.auditEvent.deleteMany())).rejects.toThrow(/permission denied|42501/);
      } finally {
        await api.$disconnect();
      }
      for (const statement of ['UPDATE audit_events SET reason = NULL', 'DELETE FROM audit_events', 'TRUNCATE audit_events']) {
        await expect(db.superuser.$executeRawUnsafe(statement)).rejects.toThrow(/append-only/);
      }
    });
  });
});
