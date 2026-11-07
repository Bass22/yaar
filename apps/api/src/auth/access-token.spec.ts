import { unwrap } from '@kit';
import { createHmac } from 'node:crypto';
import { Instant } from '@domain/journal';
import { issueAccessToken, verifyAccessToken, type SessionClaims } from './access-token';
import { SESSION_LIFETIME_SECONDS } from './session-policy';

// Spec: Cahier des charges — « Identité », session : jeton signé, 7 jours pour un gardien,
// 24 heures pour l'admin, sans renouvellement ; il porte l'utilisateur, l'élevage, le rôle,
// l'appareil et ses dates, rien d'autre. Archi §12 (HS256, secret de l'environnement).

const instant = (iso: string): Instant => unwrap(Instant(iso));
const LE_7_A_8H = instant('2026-11-07T08:00:00.000Z');
const SECRET = 'un-secret-de-test-assez-long-pour-signer-des-jetons';
const AUTRE_SECRET = 'un-autre-secret-tout-aussi-long-mais-different!!';
const OUSMANE: Omit<SessionClaims, 'iat' | 'exp'> = {
  sub: '00000000-0000-4000-8000-000000000051',
  tenant: '00000000-0000-4000-8000-000000000002',
  role: 'collaborator',
  device: '00000000-0000-4000-8000-0000000000d1',
};
const LE_GERANT = { ...OUSMANE, sub: '00000000-0000-4000-8000-000000000054', role: 'admin' as const };

const base64url = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('Jeton de session', () => {
  it("un jeton émis se vérifie, et rend ce qu'il porte : utilisateur, élevage, rôle, appareil, dates", () => {
    const token = issueAccessToken(OUSMANE, LE_7_A_8H, SECRET);

    expect(verifyAccessToken(token, LE_7_A_8H, SECRET)).toEqual({
      ok: true,
      // 2026-11-07 à 8 h UTC : 1 794 038 400 secondes depuis 1970
      value: { ...OUSMANE, iat: 1_794_038_400, exp: 1_794_038_400 + 7 * 24 * 3_600 },
    });
  });

  it("il ne porte rien d'autre : ni numéro, ni nom, ni site", () => {
    const token = issueAccessToken(OUSMANE, LE_7_A_8H, SECRET);
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;

    expect(Object.keys(payload).sort()).toEqual(['device', 'exp', 'iat', 'role', 'sub', 'tenant']);
  });

  it("un gardien reçoit sept jours, l'admin vingt-quatre heures : les durées sont des constantes", () => {
    const caretaker = unwrap(verifyAccessToken(issueAccessToken(OUSMANE, LE_7_A_8H, SECRET), LE_7_A_8H, SECRET));
    const admin = unwrap(verifyAccessToken(issueAccessToken(LE_GERANT, LE_7_A_8H, SECRET), LE_7_A_8H, SECRET));

    expect(caretaker.exp - caretaker.iat).toBe(SESSION_LIFETIME_SECONDS.collaborator);
    expect(admin.exp - admin.iat).toBe(SESSION_LIFETIME_SECONDS.admin);
    expect(SESSION_LIFETIME_SECONDS).toEqual({ collaborator: 7 * 24 * 3_600, admin: 24 * 3_600 });
  });

  it("un jeton expiré est refusé : à la seconde près, sans renouvellement", () => {
    const token = issueAccessToken(LE_GERANT, LE_7_A_8H, SECRET);
    const lastSecond = instant('2026-11-08T07:59:59.000Z');
    const expiry = instant('2026-11-08T08:00:00.000Z');

    expect(verifyAccessToken(token, lastSecond, SECRET).ok).toBe(true);
    expect(verifyAccessToken(token, expiry, SECRET)).toEqual({ ok: false, error: { kind: 'TokenExpired' } });
  });

  it("un jeton signé avec un autre secret est refusé", () => {
    const token = issueAccessToken(OUSMANE, LE_7_A_8H, AUTRE_SECRET);

    expect(verifyAccessToken(token, LE_7_A_8H, SECRET)).toEqual({ ok: false, error: { kind: 'TokenInvalid' } });
  });

  it("un jeton dont on a changé le contenu est refusé, même d'un seul caractère", () => {
    const token = issueAccessToken(OUSMANE, LE_7_A_8H, SECRET);
    const [header, payload, signature] = token.split('.') as [string, string, string];
    const promoted = base64url({ ...JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')), role: 'admin' });
    const tampered = [`${header}.${promoted}.${signature}`, `${header}.${payload}.${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`, `${header}.${payload}.`, `${header}.${payload}`];

    for (const candidate of tampered) {
      expect(verifyAccessToken(candidate, LE_7_A_8H, SECRET)).toEqual({ ok: false, error: { kind: 'TokenInvalid' } });
    }
  });

  it("l'algorithme est fixé : un jeton « none », ou d'un autre algorithme, est refusé même bien formé", () => {
    const claims = { ...OUSMANE, iat: 1_762_502_400, exp: 1_762_502_400 + 3_600 };
    const none = `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url(claims)}.`;
    const hs512Signed = (() => {
      const head = base64url({ alg: 'HS512', typ: 'JWT' });
      const signature = createHmac('sha512', SECRET).update(`${head}.${base64url(claims)}`).digest('base64url');
      return `${head}.${base64url(claims)}.${signature}`;
    })();

    // A header that lies about its algorithm, yet signed with our key and HS256: only the
    // header check refuses it.
    const lyingHeader = (alg: string): string => {
      const head = base64url({ alg, typ: 'JWT' });
      return `${head}.${base64url(claims)}.${createHmac('sha256', SECRET).update(`${head}.${base64url(claims)}`).digest('base64url')}`;
    };

    for (const candidate of [none, hs512Signed, lyingHeader('none'), lyingHeader('RS256'), lyingHeader('HS256 ')]) {
      expect(verifyAccessToken(candidate, LE_7_A_8H, SECRET)).toEqual({ ok: false, error: { kind: 'TokenInvalid' } });
    }
  });

  it("un jeton bien signé mais au contenu inattendu est refusé : rôle inconnu, identifiant qui n'est pas un UUID, date manquante", () => {
    const sign = (claims: object): string => {
      const head = base64url({ alg: 'HS256', typ: 'JWT' });
      const body = base64url(claims);
      return `${head}.${body}.${createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url')}`;
    };
    const iat = 1_762_502_400;
    const shapes = [
      { ...OUSMANE, role: 'investor', iat, exp: iat + 60 },
      { ...OUSMANE, sub: 'ousmane', iat, exp: iat + 60 },
      { ...OUSMANE, iat },
      { ...OUSMANE, iat: 'hier', exp: iat + 60 },
      { ...OUSMANE, iat, exp: iat + 60, phone: '+221770000001' },
    ];

    for (const claims of shapes) {
      expect(verifyAccessToken(sign(claims), LE_7_A_8H, SECRET)).toEqual({ ok: false, error: { kind: 'TokenInvalid' } });
    }
  });

  it("ce qui n'est pas un jeton est refusé sans lever d'erreur", () => {
    for (const candidate of ['', 'abc', 'a.b', 'a.b.c', `${'x'.repeat(5000)}.y.z`, 'Bearer x.y.z']) {
      expect(verifyAccessToken(candidate, LE_7_A_8H, SECRET)).toEqual({ ok: false, error: { kind: 'TokenInvalid' } });
    }
  });
});
