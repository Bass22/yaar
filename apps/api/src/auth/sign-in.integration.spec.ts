import { unwrap, type Clock } from '@kit';
import { Instant, instantOf } from '@domain/journal';
import type { SignInRequest } from '@contracts';
import { PrismaService } from '../database/prisma.service';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';
import { verifyAccessToken } from './access-token';
import { Argon2PinHasher } from './argon2-pin-hasher';
import { Pin } from './pin';
import type { PinHash, PinHasher } from './pin-hasher';
import { signIn, type SignInDependencies } from './sign-in';

// Spec: Cahier des charges — « Identité » : numéro + PIN, essais ratés ralentis, session de
// 7 jours ou 24 heures, compte bloqué ; backlog E.2 — même réponse pour un numéro inconnu et
// un mauvais PIN, sans écart de temps ; réserve R-12 (un essai refusé ne vérifie rien).
jest.setTimeout(180_000);

const SECRET = 'un-secret-de-test-assez-long-pour-signer-des-jetons';
const TENANT = '00000000-0000-4000-8000-00000000000a';
const OUSMANE = '00000000-0000-4000-8000-000000000051';
const LE_GERANT = '00000000-0000-4000-8000-000000000054';
const BLOQUE = '00000000-0000-4000-8000-000000000055';
const AWA = '00000000-0000-4000-8000-000000000052';
const POULAILLER_WOLOF = '00000000-0000-4000-8000-0000000000a1';
const LE_TELEPHONE = '00000000-0000-4000-8000-0000000000d1';

// A clock the test moves by hand.
function uneHorloge(iso: string): Clock & { avance(seconds: number): void } {
  let time = Date.parse(iso);
  return { now: () => new Date(time), avance: (seconds) => { time += seconds * 1_000; } };
}

// The real hasher, with its calls counted: what is verified, and how many times, is the point.
function unHacheurCompte(): PinHasher & { verifications: number } {
  const real = new Argon2PinHasher();
  const counted = {
    verifications: 0,
    hash: (pin: Pin) => real.hash(pin),
    verify: async (hash: PinHash, pin: Pin) => {
      counted.verifications += 1;
      return real.verify(hash, pin);
    },
  };
  return counted;
}

describe('Connexion', () => {
  let db: TestDatabase;
  let api: PrismaService;
  let clock: ReturnType<typeof uneHorloge>;
  let hasher: ReturnType<typeof unHacheurCompte>;
  const deps = (): SignInDependencies => ({ prisma: api, hasher, clock, jwtSecret: SECRET });
  const connecte = (request: Partial<SignInRequest>) =>
    signIn({ phone: '+221770000001', pin: '4829', deviceId: LE_TELEPHONE, ...request }, deps());
  const compteur = (id: string) => db.superuser.user.findUniqueOrThrow({ where: { id }, select: { pinFailures: true, pinLastFailureAt: true } });

  beforeAll(async () => {
    db = await createTestDatabase();
    api = new PrismaService({ port: 0, databaseUrl: db.appUrl, jwtSecret: SECRET, mediaPath: '/data/medias' });
    hasher = unHacheurCompte();
    const real = new Argon2PinHasher();
    await db.superuser.tenant.create({ data: { id: TENANT, name: 'Ferme', currency: 'XOF' } });
    await db.superuser.user.createMany({
      data: [
        { id: OUSMANE, tenantId: TENANT, phone: '+221770000001', name: 'Ousmane', role: 'collaborator', avatar: 'baobab', pinHash: await real.hash(unwrap(Pin('4829', 'collaborator'))) },
        { id: AWA, tenantId: TENANT, phone: '+221770000002', name: 'Awa', role: 'collaborator', avatar: 'pirogue', audioLanguage: 'fr', pinHash: await real.hash(unwrap(Pin('4829', 'collaborator'))) },
        { id: LE_GERANT, tenantId: TENANT, phone: '+221770000054', name: 'Le gérant', role: 'admin', pinHash: await real.hash(unwrap(Pin('482913', 'admin'))) },
        { id: BLOQUE, tenantId: TENANT, phone: '+221770000055', name: 'Ancien gardien', role: 'collaborator', pinHash: await real.hash(unwrap(Pin('4829', 'collaborator'))), blockedAt: new Date('2026-11-01T00:00:00.000Z') },
      ],
    });
  });

  beforeAll(async () => {
    // Ousmane and Awa keep the notebook of a site whose voice is Wolof by default.
    await db.superuser.site.create({ data: { id: POULAILLER_WOLOF, tenantId: TENANT, name: 'Thiès', timeZone: 'Africa/Dakar', audioLanguage: 'wo' } });
    await db.superuser.siteAssignment.createMany({
      data: [
        { tenantId: TENANT, siteId: POULAILLER_WOLOF, userId: OUSMANE, isPrimary: true },
        { tenantId: TENANT, siteId: POULAILLER_WOLOF, userId: AWA, isPrimary: false },
      ],
    });
  });

  beforeEach(() => {
    clock = uneHorloge('2026-11-07T08:00:00.000Z');
    hasher.verifications = 0;
  });

  afterAll(async () => {
    await api?.$disconnect();
    await db?.drop();
  });

  describe('une session liée à l’appareil', () => {
    it("un numéro et un PIN corrects ouvrent une session de sept jours pour un gardien, portée par un jeton qui nomme l'appareil", async () => {
      const result = await connecte({});

      expect(result.ok).toBe(true);
      const session = unwrap(result);
      expect(session).toMatchObject({ role: 'collaborator', expiresAt: '2026-11-14T08:00:00.000Z' });
      expect(unwrap(verifyAccessToken(session.token, instantOf(clock.now()), SECRET))).toMatchObject({ sub: OUSMANE, tenant: TENANT, role: 'collaborator', device: LE_TELEPHONE });
    });

    it("l'admin reçoit une session de vingt-quatre heures", async () => {
      const session = unwrap(await connecte({ phone: '+221770000054', pin: '482913' }));

      expect(session).toMatchObject({ role: 'admin', expiresAt: '2026-11-08T08:00:00.000Z' });
    });

    it("un appareil sans identifiant, ou un numéro mal écrit, ou un PIN qui n'en est pas un : requête refusée, sans rien vérifier ni compter", async () => {
      const bad: Partial<SignInRequest>[] = [{ deviceId: 'mon-telephone' }, { deviceId: '' }, { phone: '771234567' }, { pin: '48' }, { pin: '4829137' }, { pin: 'abcd' }];

      for (const request of bad) {
        expect(await connecte(request)).toEqual({ ok: false, error: { kind: 'InvalidRequest' } });
      }
      expect(hasher.verifications).toBe(0);
      expect(await compteur(OUSMANE)).toMatchObject({ pinFailures: 0 });
    });
  });

  // Spec: backlog E.9 — le téléphone garde le compte (nom, avatar) ; la langue suit la personne, sinon son site (décision du 2026-11-07)
  describe('ce que le téléphone retient du compte', () => {
    it("la session dit le nom et l'avatar du compte, et la langue de son site quand il n'en a pas choisi", async () => {
      expect(unwrap(await connecte({})).account).toEqual({ name: 'Ousmane', avatar: 'baobab', language: 'wo' });
    });

    it("la langue choisie pour la personne l'emporte sur celle du site", async () => {
      expect(unwrap(await connecte({ phone: '+221770000002' })).account).toEqual({ name: 'Awa', avatar: 'pirogue', language: 'fr' });
    });

    it("sans avatar ni site, le compte n'a pas d'avatar et parle français, la langue des premiers clips", async () => {
      expect(unwrap(await connecte({ phone: '+221770000054', pin: '482913' })).account).toEqual({ name: 'Le gérant', avatar: null, language: 'fr' });
    });
  });

  describe('numéro inconnu et mauvais PIN', () => {
    it("reçoivent la même réponse, et coûtent le même travail : une vérification d'empreinte chacun", async () => {
      const unknown = await connecte({ phone: '+221770000099' });
      const afterUnknown = hasher.verifications;
      const wrong = await connecte({ pin: '4820' });

      expect(unknown).toEqual({ ok: false, error: { kind: 'InvalidCredentials' } });
      expect(wrong).toEqual(unknown);
      expect(afterUnknown).toBe(1);
      expect(hasher.verifications).toBe(2);
    });

    it("un PIN de la mauvaise longueur pour le rôle est un mauvais PIN comme un autre : même réponse, même travail, et il compte", async () => {
      const before = (await compteur(OUSMANE)).pinFailures;

      expect(await connecte({ pin: '482913' })).toEqual({ ok: false, error: { kind: 'InvalidCredentials' } });
      expect(hasher.verifications).toBe(1);
      expect((await compteur(OUSMANE)).pinFailures).toBe(before + 1);
    });
  });

  describe('les essais sont comptés', () => {
    it("après trois essais ratés de suite, le quatrième est refusé pendant trente secondes sans que le PIN soit vérifié, et il ne compte pas", async () => {
      // Given le compteur remis à zéro par une connexion réussie, puis trois essais ratés
      await connecte({});
      for (let failures = 0; failures < 3; failures += 1) {
        await connecte({ pin: '0000' });
      }
      hasher.verifications = 0;

      // When un quatrième essai, tout de suite — avec le bon PIN
      const tooEarly = await connecte({});

      // Then
      expect(tooEarly).toEqual({ ok: false, error: { kind: 'TooManyAttempts', retryAt: '2026-11-07T08:00:30.000Z' } });
      expect(hasher.verifications).toBe(0);
      expect(await compteur(OUSMANE)).toMatchObject({ pinFailures: 3, pinLastFailureAt: new Date('2026-11-07T08:00:00.000Z') });
    });

    it("l'attente écoulée, l'essai est permis ; raté, il allonge l'attente ; réussi, il remet le compteur à zéro", async () => {
      // Given trois essais ratés à 8 h 00 (le test précédent), et l'horloge à 8 h 00 min 30 s
      clock.avance(30);

      // When un quatrième essai raté, puis à 8 h 01 min 30 s le bon PIN
      expect(await connecte({ pin: '0000' })).toEqual({ ok: false, error: { kind: 'InvalidCredentials' } });
      expect(await connecte({})).toMatchObject({ ok: false, error: { kind: 'TooManyAttempts', retryAt: '2026-11-07T08:01:30.000Z' } });
      clock.avance(60);
      const success = await connecte({});

      // Then
      expect(success.ok).toBe(true);
      expect(await compteur(OUSMANE)).toEqual({ pinFailures: 0, pinLastFailureAt: null });
    });
  });

  describe('un compte bloqué', () => {
    it("est refusé comme bloqué, mais seulement à qui connaît son PIN : un mauvais PIN reçoit la réponse ordinaire", async () => {
      expect(await connecte({ phone: '+221770000055', pin: '4829' })).toEqual({ ok: false, error: { kind: 'AccountBlocked' } });
      expect(await connecte({ phone: '+221770000055', pin: '0000' })).toEqual({ ok: false, error: { kind: 'InvalidCredentials' } });
    });
  });

  it("une connexion ne modifie que le compteur d'essais de son propre compte", async () => {
    const snapshot = await db.superuser.user.findUniqueOrThrow({ where: { id: LE_GERANT } });

    await connecte({ pin: '0000' });
    await connecte({});

    expect(await db.superuser.user.findUniqueOrThrow({ where: { id: LE_GERANT } })).toEqual(snapshot);
  });

  it("les instants sont ceux de l'horloge du serveur, jamais de la requête", async () => {
    clock = uneHorloge('2030-01-01T00:00:00.000Z');

    const session = unwrap(await connecte({}));

    expect(session.expiresAt).toBe('2030-01-08T00:00:00.000Z');
    expect(unwrap(verifyAccessToken(session.token, unwrap(Instant('2030-01-01T00:00:00.000Z')), SECRET)).iat).toBe(Math.floor(Date.parse('2030-01-01T00:00:00.000Z') / 1_000));
  });
});
