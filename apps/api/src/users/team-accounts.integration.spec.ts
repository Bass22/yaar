import { Controller, Get, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { unwrap, type Clock } from '@kit';
import { Instant } from '@domain/journal';
import { AppModule } from '../app.module';
import { issueAccessToken } from '../auth/access-token';
import { Argon2PinHasher } from '../auth/argon2-pin-hasher';
import { CLOCK } from '../auth/auth.module';
import { Pin } from '../auth/pin';
import { APP_CONFIG } from '../config/app-config';
import { configureApp } from '../create-app';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';

// Spec: Cahier des charges — « Identité » (premier PIN : l'admin donne un PIN provisoire, le
// collaborateur tape le provisoire et choisit le sien en une seule étape, avant toute
// session ; le provisoire expire au bout de 7 jours ; un PIN oublié se remplace de même) ;
// backlog E.5. Tourne sur un PostgreSQL réel, à travers le serveur HTTP.
jest.setTimeout(180_000);

const SECRET = 'un-secret-de-test-assez-long-pour-signer-des-jetons';
const TENANT_A = '00000000-0000-4000-8000-00000000000a';
const LE_GERANT = '00000000-0000-4000-8000-000000000054';
const OUSMANE = '00000000-0000-4000-8000-000000000051';
const AWA = '00000000-0000-4000-8000-000000000052';
const MODOU = '00000000-0000-4000-8000-000000000053';
const TELEPHONE = '00000000-0000-4000-8000-0000000000d1';

type Json = Record<string, unknown>;

// A route written for the test, without @Public(): it answers 200 to any standing session.
@Controller('probe')
class ProbeController {
  @Get()
  ping(): { ok: true } {
    return { ok: true };
  }
}

describe("Comptes de l'équipe et premier PIN", () => {
  let db: TestDatabase;
  let app: INestApplication;
  let origin: string;
  let now = Date.parse('2026-11-07T08:00:00.000Z');
  const clock: Clock = { now: () => new Date(now) };
  const at = (iso: string) => {
    now = Date.parse(iso);
  };

  const gerant = () => issueAccessToken({ sub: LE_GERANT, tenant: TENANT_A, role: 'admin', device: TELEPHONE }, unwrap(Instant(new Date(now).toISOString())), SECRET);
  const post = (path: string, body: unknown, token?: string) =>
    fetch(`${origin}/api/v1/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }) },
      body: JSON.stringify(body),
    });
  const create = async (id: string, phone: string, token = gerant()) => post('users', { id, phone, name: 'Gardien' }, token);
  const signIn = (phone: string, pin: string) => post('auth/sign-in', { phone, pin, deviceId: TELEPHONE });
  const choosePin = (phone: string, provisionalPin: string, newPin: string) => post('auth/choose-pin', { phone, provisionalPin, newPin, deviceId: TELEPHONE });

  beforeAll(async () => {
    db = await createTestDatabase();
    await db.owner.tenant.create({ data: { id: TENANT_A, name: 'Ferme', currency: 'XOF' } });
    await db.owner.user.create({
      data: { id: LE_GERANT, tenantId: TENANT_A, phone: '+221770000054', name: 'Le gérant', role: 'admin', pinHash: await new Argon2PinHasher().hash(unwrap(Pin('482913', 'admin'))) },
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

  let ousmaneProvisional = '';

  describe("l'admin crée un compte", () => {
    it("un collaborateur, avec un PIN provisoire de quatre chiffres tiré au hasard, montré une seule fois, valable sept jours", async () => {
      at('2026-11-07T08:00:00.000Z');
      const response = await create(OUSMANE, '+221770000051');
      const body = (await response.json()) as Json;

      expect(response.status).toBe(201);
      expect(body).toEqual({ id: OUSMANE, role: 'collaborator', provisionalPin: expect.stringMatching(/^[0-9]{4}$/), provisionalPinExpiresAt: '2026-11-14T08:00:00.000Z' });
      ousmaneProvisional = body['provisionalPin'] as string;
      expect(Pin(ousmaneProvisional, 'collaborator').ok).toBe(true);

      const stored = await db.owner.user.findUniqueOrThrow({ where: { id: OUSMANE } });
      expect(stored).toMatchObject({ tenantId: TENANT_A, role: 'collaborator', provisionalPinExpiresAt: new Date('2026-11-14T08:00:00.000Z') });
      expect(stored.pinHash).toMatch(/^\$argon2id\$/);
      expect(stored.pinHash).not.toContain(ousmaneProvisional);
    });

    it("deux comptes reçoivent des PIN provisoires indépendants : jamais trop simples", async () => {
      const pins = new Set<string>();
      for (let rank = 0; rank < 6; rank += 1) {
        const id = `00000000-0000-4000-8000-0000000001${String(rank).padStart(2, '0')}`;
        const body = (await (await create(id, `+2217700001${String(rank).padStart(2, '0')}`)).json()) as Json;
        expect(Pin(body['provisionalPin'], 'collaborator').ok).toBe(true);
        pins.add(body['provisionalPin'] as string);
      }
      expect(pins.size).toBeGreaterThan(1);
    });

    it("la requête ne choisit ni le rôle ni le PIN, ni l'élevage : un champ de plus est refusé", async () => {
      for (const extra of [{ role: 'admin' }, { pin: '4829' }, { tenantId: '00000000-0000-4000-8000-00000000000b' }]) {
        const response = await post('users', { id: AWA, phone: '+221770000052', name: 'Awa', ...extra }, gerant());
        expect(response.status).toBe(400);
      }
      expect(await db.owner.user.count({ where: { id: AWA } })).toBe(0);
    });

    it("un numéro qui a déjà un compte est refusé, sans rien créer", async () => {
      const response = await create(AWA, '+221770000051');

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ kind: 'PhoneAlreadyUsed' });
      expect(await db.owner.user.count({ where: { id: AWA } })).toBe(0);
    });

    it("un identifiant, un numéro ou un nom invalides sont refusés", async () => {
      for (const body of [{ id: 'awa', phone: '+221770000052', name: 'Awa' }, { id: AWA, phone: '770000052', name: 'Awa' }, { id: AWA, phone: '+221770000052', name: '  ' }]) {
        expect((await post('users', body, gerant())).status).toBe(400);
      }
    });

    it("un collaborateur ne crée pas de compte", async () => {
      const ousmane = issueAccessToken({ sub: OUSMANE, tenant: TENANT_A, role: 'collaborator', device: TELEPHONE }, unwrap(Instant(new Date(now).toISOString())), SECRET);

      expect((await create(AWA, '+221770000052', ousmane)).status).toBe(403);
    });
  });

  describe('la première connexion', () => {
    it("avec le seul PIN provisoire, la connexion ordinaire est refusée et dit qu'il faut choisir son PIN", async () => {
      const response = await signIn('+221770000051', ousmaneProvisional);

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ kind: 'PinMustBeChosen' });
    });

    it("le nouveau PIN suit les règles : quatre chiffres, pas trop simple, différent du provisoire", async () => {
      const refusals: [string, Json][] = [
        ['482913', { kind: 'InvalidPin', expectedDigits: 4 }],
        ['1234', { kind: 'TrivialPin' }],
        [ousmaneProvisional, { kind: 'SameAsProvisionalPin' }],
      ];

      for (const [newPin, refusal] of refusals) {
        const response = await choosePin('+221770000051', ousmaneProvisional, newPin);
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual(refusal);
      }
    });

    it("un mauvais PIN provisoire est un mauvais PIN : 401, comme à la connexion", async () => {
      const wrong = ousmaneProvisional === '5937' ? '5938' : '5937';

      expect((await choosePin('+221770000051', wrong, '7351')).status).toBe(401);
      expect((await choosePin('+221770000099', wrong, '7351')).status).toBe(401);
    });

    it("le provisoire et un nouveau PIN ouvrent la première session ; ensuite, seul le nouveau PIN marche", async () => {
      const response = await choosePin('+221770000051', ousmaneProvisional, '7351');
      const body = (await response.json()) as Json;

      expect(response.status).toBe(200);
      expect(body).toMatchObject({ role: 'collaborator', expiresAt: '2026-11-14T08:00:00.000Z', token: expect.any(String) });
      expect((await signIn('+221770000051', ousmaneProvisional)).status).toBe(401);
      expect((await signIn('+221770000051', '7351')).status).toBe(200);
      expect(await db.owner.user.findUniqueOrThrow({ where: { id: OUSMANE } })).toMatchObject({ provisionalPinExpiresAt: null, pinFailures: 0 });
    });

    it("une fois son PIN choisi, on ne le rechoisit pas par cette voie", async () => {
      const response = await choosePin('+221770000051', '7351', '6284');

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ kind: 'PinAlreadyChosen' });
    });

    it("un PIN provisoire expire au bout de sept jours : ni connexion, ni choix", async () => {
      // Given Modou créé le 7 à 8 h
      at('2026-11-07T08:00:00.000Z');
      const provisional = ((await (await create(MODOU, '+221770000053')).json()) as Json)['provisionalPin'] as string;

      // When le 14 à 8 h
      at('2026-11-14T08:00:00.000Z');
      const response = await choosePin('+221770000053', provisional, '7351');

      // Then
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ kind: 'ProvisionalPinExpired' });
      expect((await signIn('+221770000053', provisional)).status).toBe(403);
    });
  });

  describe('un PIN oublié', () => {
    it("l'admin donne un nouveau PIN provisoire : l'ancien PIN ne marche plus, les jetons émis avant non plus", async () => {
      // Given Ousmane connecté avec son PIN 7351, le 14 à 8 h
      at('2026-11-14T08:00:00.000Z');
      const before = ((await (await signIn('+221770000051', '7351')).json()) as Json)['token'] as string;
      expect((await fetch(`${origin}/api/v1/probe`, { headers: { Authorization: `Bearer ${before}` } })).status).toBe(200);

      // When le gérant lui donne un PIN provisoire, à 9 h
      at('2026-11-14T09:00:00.000Z');
      const response = await post(`users/${OUSMANE}/reset-pin`, {}, gerant());
      const body = (await response.json()) as Json;

      // Then
      expect(response.status).toBe(200);
      expect(body).toEqual({ provisionalPin: expect.stringMatching(/^[0-9]{4}$/), provisionalPinExpiresAt: '2026-11-21T09:00:00.000Z' });
      expect((await signIn('+221770000051', '7351')).status).toBe(401);
      expect((await fetch(`${origin}/api/v1/probe`, { headers: { Authorization: `Bearer ${before}` } })).status).toBe(401);
      at('2026-11-14T09:00:01.000Z');
      expect((await choosePin('+221770000051', body['provisionalPin'] as string, '6284')).status).toBe(200);
    });

    it("l'admin ne remplace pas le PIN d'un admin, ni le sien, ni celui d'un compte qui n'existe pas", async () => {
      expect((await post(`users/${LE_GERANT}/reset-pin`, {}, gerant())).status).toBe(403);
      expect((await post(`users/${AWA}/reset-pin`, {}, gerant())).status).toBe(404);
    });
  });
});
