import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { unwrap, type Clock } from '@kit';
import { AppModule } from '../app.module';
import { APP_CONFIG } from '../config/app-config';
import { configureApp } from '../create-app';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';
import { Argon2PinHasher } from './argon2-pin-hasher';
import { CLOCK } from './auth.module';
import { Pin } from './pin';

// Spec: backlog E.2 — se connecter avec son numéro et son PIN ; même réponse pour un numéro
// inconnu et un mauvais PIN ; le PIN n'apparaît dans aucun journal applicatif.
jest.setTimeout(180_000);

const SECRET = 'un-secret-de-test-assez-long-pour-signer-des-jetons';
const TENANT = '00000000-0000-4000-8000-00000000000a';
const LE_TELEPHONE = '00000000-0000-4000-8000-0000000000d1';

describe('Route de connexion', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let origin: string;
  let now = Date.parse('2026-11-07T08:00:00.000Z');
  const clock: Clock = { now: () => new Date(now) };
  const post = (body: unknown, raw = false) =>
    fetch(`${origin}/api/v1/auth/sign-in`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw ? (body as string) : JSON.stringify(body) });
  const ousmane = (pin = '4829') => ({ phone: '+221770000001', pin, deviceId: LE_TELEPHONE });

  beforeAll(async () => {
    db = await createTestDatabase();
    await db.owner.tenant.create({ data: { id: TENANT, name: 'Ferme', currency: 'XOF' } });
    const hasher = new Argon2PinHasher();
    await db.owner.user.create({
      data: { id: '00000000-0000-4000-8000-000000000055', tenantId: TENANT, phone: '+221770000055', name: 'Ancien gardien', role: 'collaborator', blockedAt: new Date('2026-11-01T00:00:00.000Z'), pinHash: await hasher.hash(unwrap(Pin('4829', 'collaborator'))) },
    });
    await db.owner.user.create({
      data: { id: '00000000-0000-4000-8000-000000000051', tenantId: TENANT, phone: '+221770000001', name: 'Ousmane', role: 'collaborator', pinHash: await new Argon2PinHasher().hash(unwrap(Pin('4829', 'collaborator'))) },
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
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

  it('un numéro et un PIN corrects ouvrent une session : 200, le jeton, son expiration et le rôle — rien d’autre', async () => {
    const response = await post(ousmane());
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(['expiresAt', 'role', 'token']);
    expect(body).toMatchObject({ role: 'collaborator', expiresAt: '2026-11-14T08:00:00.000Z' });
    expect(JSON.stringify(body)).not.toMatch(/4829|pin|\+221/i);
  });

  it('un numéro inconnu et un mauvais PIN reçoivent exactement la même réponse : 401', async () => {
    const unknown = await post({ ...ousmane(), phone: '+221770000099' });
    const wrong = await post(ousmane('0000'));

    expect([unknown.status, wrong.status]).toEqual([401, 401]);
    expect(await unknown.text()).toBe(await wrong.text());
  });

  it("pendant l'attente : 429, avec l'instant du prochain essai et l'en-tête Retry-After", async () => {
    // Given trois essais ratés (le test précédent en a compté un)
    await post(ousmane('0000'));
    await post(ousmane('0000'));

    const response = await post(ousmane());

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('30');
    expect(await response.json()).toEqual({ kind: 'TooManyAttempts', retryAt: '2026-11-07T08:00:30.000Z' });
    now += 30_000;
  });

  it("un compte bloqué, à qui tape son PIN : 403, distinct du 401 d'un mauvais PIN", async () => {
    const blocked = await post({ phone: '+221770000055', pin: '4829', deviceId: LE_TELEPHONE });
    const wrongPin = await post({ phone: '+221770000055', pin: '0000', deviceId: LE_TELEPHONE });

    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toEqual({ kind: 'AccountBlocked' });
    expect(wrongPin.status).toBe(401);
  });

  it("une requête mal formée est refusée en 400, sans rien vérifier : JSON cassé, champ manquant, champ de trop", async () => {
    const malformed = [
      await post('{"phone": ', true),
      await post({ phone: '+221770000001', pin: '4829' }),
      await post({ ...ousmane(), tenantId: TENANT }),
      await post([ousmane()]),
      await post('null', true),
    ];

    for (const response of malformed) {
      expect(response.status).toBe(400);
      expect(await response.text()).not.toContain('4829');
    }
  });

  it("le PIN n'apparaît dans aucun journal applicatif, même quand la connexion échoue", async () => {
    const written: string[] = [];
    const capture = (stream: NodeJS.WriteStream) => jest.spyOn(stream, 'write').mockImplementation((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    });
    const spies = [capture(process.stdout), capture(process.stderr)];
    try {
      await post(ousmane('7351'));
      await post({ ...ousmane('7351'), phone: '+221770000099' });
      await post('{"pin": "7351", ', true);
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }

    expect(written.join('')).not.toContain('7351');
  });
});
