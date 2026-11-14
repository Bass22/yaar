import { unwrap, type Clock } from '@kit';
import { Instant, instantOf } from '@domain/journal';
import type { SignInRequest } from '@contracts';
import { PrismaService } from '../database/prisma.service';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';
import { verifyAccessToken } from './access-token';
import { Argon2PinHasher } from './argon2-pin-hasher';
import { Pin } from './pin';
import type { PinHash, PinHasher } from './pin-hasher';
import { signIn, UnknownNumberAttempts, type SignInDependencies } from './sign-in';

// Spec: Cahier des charges — « Identité » : numéro + PIN, essais ratés ralentis, session de
// 7 jours ou 24 heures, compte bloqué ; backlog E.2 — même réponse pour un numéro inconnu et
// un mauvais PIN, sans écart de temps ; réserve R-12 (un essai refusé ne vérifie rien) ;
// backlog E.10 (décision du 2026-11-13) — essais comptés par appareil, réservés avant la
// vérification, plafond de 20 échecs en 24 h pour un appareil inconnu du compte, numéros
// inconnus comptés comme les autres (réserves R-14, R-15, R-16).
jest.setTimeout(180_000);

const SECRET = 'un-secret-de-test-assez-long-pour-signer-des-jetons';
const TENANT = '00000000-0000-4000-8000-00000000000a';
const OUSMANE = '00000000-0000-4000-8000-000000000051';
const LE_GERANT = '00000000-0000-4000-8000-000000000054';
const BLOQUE = '00000000-0000-4000-8000-000000000055';
const AWA = '00000000-0000-4000-8000-000000000052';
const POULAILLER_WOLOF = '00000000-0000-4000-8000-0000000000a1';
const MOUSSA = '00000000-0000-4000-8000-000000000056';
const LE_TELEPHONE = '00000000-0000-4000-8000-0000000000d1';
const UN_AUTRE = '00000000-0000-4000-8000-0000000000d2';
const UN_NEUF = '00000000-0000-4000-8000-0000000000d3';
const appareil = (rank: number): string => `00000000-0000-4000-8000-0000000001${String(rank).padStart(2, '0')}`;

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
  let unknownNumbers: UnknownNumberAttempts;
  const deps = (): SignInDependencies => ({ prisma: api, hasher, clock, jwtSecret: SECRET, unknownNumbers });
  const connecte = (request: Partial<SignInRequest>) =>
    signIn({ phone: '+221770000001', pin: '4829', deviceId: LE_TELEPHONE, ...request }, deps());
  // The counter of one account on one device; none yet reads as no failure.
  const compteur = async (userId: string, deviceId = LE_TELEPHONE) =>
    (await db.superuser.signInAttempt.findUnique({ where: { tenantId_userId_deviceId: { tenantId: TENANT, userId, deviceId } }, select: { failures: true, lastFailureAt: true, knownSince: true } })) ?? {
      failures: 0,
      lastFailureAt: null,
      knownSince: null,
    };

  beforeAll(async () => {
    db = await createTestDatabase();
    api = new PrismaService({ port: 0, databaseUrl: db.appUrl, jwtSecret: SECRET, mediaPath: '/data/medias', vapidPublicKey: null });
    hasher = unHacheurCompte();
    unknownNumbers = new UnknownNumberAttempts();
    const real = new Argon2PinHasher();
    await db.superuser.tenant.create({ data: { id: TENANT, name: 'Ferme', currency: 'XOF' } });
    await db.superuser.user.createMany({
      data: [
        { id: OUSMANE, tenantId: TENANT, phone: '+221770000001', name: 'Ousmane', role: 'collaborator', avatar: 'baobab', pinHash: await real.hash(unwrap(Pin('4829', 'collaborator'))) },
        { id: AWA, tenantId: TENANT, phone: '+221770000002', name: 'Awa', role: 'collaborator', avatar: 'pirogue', audioLanguage: 'fr', pinHash: await real.hash(unwrap(Pin('4829', 'collaborator'))) },
        { id: LE_GERANT, tenantId: TENANT, phone: '+221770000054', name: 'Le gérant', role: 'admin', pinHash: await real.hash(unwrap(Pin('482913', 'admin'))) },
        { id: MOUSSA, tenantId: TENANT, phone: '+221770000056', name: 'Moussa', role: 'collaborator', pinHash: await real.hash(unwrap(Pin('4829', 'collaborator'))) },
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
      expect(await compteur(OUSMANE)).toMatchObject({ failures: 0 });
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
      const before = (await compteur(OUSMANE)).failures;

      expect(await connecte({ pin: '482913' })).toEqual({ ok: false, error: { kind: 'InvalidCredentials' } });
      expect(hasher.verifications).toBe(1);
      expect((await compteur(OUSMANE)).failures).toBe(before + 1);
    });
  });

  describe('les essais sont comptés, appareil par appareil', () => {
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
      expect(await compteur(OUSMANE)).toMatchObject({ failures: 3, lastFailureAt: new Date('2026-11-07T08:00:00.000Z') });
    });

    it("l'attente écoulée, l'essai est permis ; raté, il allonge l'attente ; réussi, il remet le compteur de l'appareil à zéro et le fait connaître du compte", async () => {
      // Given trois essais ratés à 8 h 00 (le test précédent), et l'horloge à 8 h 00 min 30 s
      clock.avance(30);

      // When un quatrième essai raté, puis à 8 h 01 min 30 s le bon PIN
      expect(await connecte({ pin: '0000' })).toEqual({ ok: false, error: { kind: 'InvalidCredentials' } });
      expect(await connecte({})).toMatchObject({ ok: false, error: { kind: 'TooManyAttempts', retryAt: '2026-11-07T08:01:30.000Z' } });
      clock.avance(60);
      const success = await connecte({});

      // Then
      expect(success.ok).toBe(true);
      // Connu depuis sa première connexion réussie, à 8 h 00 : la date ne bouge plus
      expect(await compteur(OUSMANE)).toEqual({ failures: 0, lastFailureAt: null, knownSince: new Date('2026-11-07T08:00:00.000Z') });
    });

    it("l'attente ne frappe que l'appareil qui se trompe : le téléphone du gardien, déjà connu, se connecte aussitôt, et un appareil neuf n'est pas ralenti (R-14)", async () => {
      // Given quelqu'un qui martèle le numéro d'Ousmane depuis un autre appareil, jusqu'à l'attente
      for (let failures = 0; failures < 3; failures += 1) {
        await connecte({ pin: '0000', deviceId: UN_AUTRE });
      }
      expect(await connecte({ deviceId: UN_AUTRE })).toMatchObject({ ok: false, error: { kind: 'TooManyAttempts' } });

      // Then
      expect((await connecte({})).ok).toBe(true);
      expect((await connecte({ deviceId: UN_NEUF })).ok).toBe(true);
    });

    it("dix essais envoyés au même instant depuis un appareil : trois seulement sont vérifiés, les autres attendent (R-15)", async () => {
      const results = await Promise.all(Array.from({ length: 10 }, () => connecte({ phone: '+221770000002', pin: '0000', deviceId: appareil(90) })));

      expect(results.filter((result) => !result.ok && result.error.kind === 'InvalidCredentials')).toHaveLength(3);
      expect(results.filter((result) => !result.ok && result.error.kind === 'TooManyAttempts')).toHaveLength(7);
      expect(hasher.verifications).toBe(3);
      expect(await compteur(AWA, appareil(90))).toMatchObject({ failures: 3 });
    });
  });

  describe('un compte martelé depuis beaucoup d’appareils (R-14)', () => {
    it("au-delà de vingt échecs en 24 h, un appareil qui ne s'est jamais connecté attend, le refus est tracé ; le téléphone connu du gardien entre toujours ; 24 h après, l'attente est levée", async () => {
      // Given Moussa connecté hier sur son téléphone, puis vingt échecs aujourd'hui sur sept appareils
      clock = uneHorloge('2026-11-06T08:00:00.000Z');
      expect((await connecte({ phone: '+221770000056' })).ok).toBe(true);
      clock = uneHorloge('2026-11-07T08:00:00.000Z');
      for (let failure = 0; failure < 20; failure += 1) {
        await connecte({ phone: '+221770000056', pin: '0000', deviceId: appareil(Math.floor(failure / 3)) });
      }
      hasher.verifications = 0;

      // When un appareil neuf essaie, avec le bon PIN
      const neuf = await connecte({ phone: '+221770000056', deviceId: appareil(50) });

      // Then
      expect(neuf).toEqual({ ok: false, error: { kind: 'TooManyAttempts', retryAt: '2026-11-08T08:00:00.000Z' } });
      expect(hasher.verifications).toBe(0);
      expect(await db.superuser.auditEvent.count({ where: { action: 'SignInRefused', subjectId: MOUSSA, reason: 'TooManyFailuresOnAccount' } })).toBe(1);
      expect((await connecte({ phone: '+221770000056' })).ok).toBe(true);

      clock.avance(24 * 3_600);
      expect((await connecte({ phone: '+221770000056', deviceId: appareil(50) })).ok).toBe(true);
    });
  });

  describe('un numéro inconnu répond comme un numéro connu (R-16)', () => {
    it("trois essais libres par appareil, puis la même attente ; un autre appareil n'est pas ralenti", async () => {
      for (let failures = 0; failures < 3; failures += 1) {
        expect(await connecte({ phone: '+221770000077' })).toEqual({ ok: false, error: { kind: 'InvalidCredentials' } });
      }
      hasher.verifications = 0;

      expect(await connecte({ phone: '+221770000077' })).toEqual({ ok: false, error: { kind: 'TooManyAttempts', retryAt: '2026-11-07T08:00:30.000Z' } });
      expect(hasher.verifications).toBe(0);
      expect(await connecte({ phone: '+221770000077', deviceId: UN_AUTRE })).toEqual({ ok: false, error: { kind: 'InvalidCredentials' } });
    });

    it("au-delà de vingt échecs en 24 h, un nouvel appareil attend, comme sur un vrai compte", async () => {
      for (let failure = 0; failure < 20; failure += 1) {
        await connecte({ phone: '+221770000078', deviceId: appareil(Math.floor(failure / 3)) });
      }

      expect(await connecte({ phone: '+221770000078', deviceId: appareil(60) })).toEqual({ ok: false, error: { kind: 'TooManyAttempts', retryAt: '2026-11-08T08:00:00.000Z' } });
    });
  });

  describe('un compte bloqué', () => {
    it("est refusé comme bloqué, mais seulement à qui connaît son PIN : un mauvais PIN reçoit la réponse ordinaire", async () => {
      expect(await connecte({ phone: '+221770000055', pin: '4829' })).toEqual({ ok: false, error: { kind: 'AccountBlocked' } });
      expect(await connecte({ phone: '+221770000055', pin: '0000' })).toEqual({ ok: false, error: { kind: 'InvalidCredentials' } });
    });

    it("un PIN juste remet le compteur de l'appareil à zéro, même si la connexion est refusée pour une autre raison (E.10)", async () => {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        expect(await connecte({ phone: '+221770000055', pin: '4829', deviceId: appareil(70) })).toEqual({ ok: false, error: { kind: 'AccountBlocked' } });
      }
      expect(await compteur(BLOQUE, appareil(70))).toMatchObject({ failures: 0, knownSince: null });
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
