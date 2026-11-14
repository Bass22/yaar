import { loadAppConfig, loadDatabaseUrl } from './app-config';

// Spec: backlog D.1 — l'API refuse de démarrer sans DATABASE_URL (configuration validée au
// démarrage) ; CLAUDE.md §4 règle 6 (fail-closed).

const UNE_BASE = 'postgresql://yaar:s3cr3t-de-test@db:5432/yaar';
const UN_SECRET = 'un-secret-de-test-assez-long-pour-signer-des-jetons';
const OK = { DATABASE_URL: UNE_BASE, JWT_SECRET: UN_SECRET, MEDIA_PATH: '/data/medias' };

describe("Configuration de l'API", () => {
  it("la configuration se lit dans l'environnement : la base, et le port (3000 par défaut)", () => {
    expect(loadAppConfig(OK)).toEqual({ databaseUrl: UNE_BASE, jwtSecret: UN_SECRET, port: 3000, mediaPath: '/data/medias', vapidPublicKey: null, vapidPrivateKey: null, vapidSubject: null });
    expect(loadAppConfig({ ...OK, PORT: '8081' })).toEqual({ databaseUrl: UNE_BASE, jwtSecret: UN_SECRET, port: 8081, mediaPath: '/data/medias', vapidPublicKey: null, vapidPrivateKey: null, vapidSubject: null });
  });

  // Spec: backlog Y.1 — la clé publique des notifications : facultative (sans elle, rien n'est proposé), jamais fausse
  it('VAPID_PUBLIC_KEY est facultative ; présente, elle doit être une clé publique P-256 en base64url, et le message ne la répète pas', () => {
    const key = `B${'A'.repeat(86)}`;
    const rest = { VAPID_PRIVATE_KEY: 'p'.repeat(43), VAPID_SUBJECT: 'mailto:contact@exemple.sn' };
    expect(loadAppConfig({ ...OK, ...rest, VAPID_PUBLIC_KEY: key }).vapidPublicKey).toBe(key);
    expect(loadAppConfig({ ...OK, VAPID_PUBLIC_KEY: '' }).vapidPublicKey).toBeNull();
    for (const wrong of ['cle-trop-courte', `B${'A'.repeat(85)}+`, `${key}A`]) {
      expect(() => loadAppConfig({ ...OK, ...rest, VAPID_PUBLIC_KEY: wrong })).toThrow(/VAPID_PUBLIC_KEY/);
      expect(() => loadAppConfig({ ...OK, ...rest, VAPID_PUBLIC_KEY: wrong })).not.toThrow(new RegExp(wrong.slice(0, 12)));
    }
  });

  // Spec: backlog Y.2a — envoyer demande la paire et un contact : les trois ensemble, ou aucune
  it('la clé privée et le contact (VAPID_SUBJECT, mailto: ou https:) vont avec la clé publique : les trois, ou aucune ; le message ne répète jamais la clé privée', () => {
    const publicKey = `B${'A'.repeat(86)}`;
    const privateKey = 'p'.repeat(43);
    const all = { ...OK, VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: 'mailto:contact@exemple.sn' };
    expect(loadAppConfig(all)).toMatchObject({ vapidPublicKey: publicKey, vapidPrivateKey: privateKey, vapidSubject: 'mailto:contact@exemple.sn' });
    expect(loadAppConfig({ ...all, VAPID_SUBJECT: 'https://yaar.exemple.sn' }).vapidSubject).toBe('https://yaar.exemple.sn');
    // Il en manque une : le message dit qu'elles vont ensemble
    for (const partial of [{ ...all, VAPID_PRIVATE_KEY: '' }, { ...all, VAPID_SUBJECT: '' }, { ...OK, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: 'mailto:contact@exemple.sn' }]) {
      expect(() => loadAppConfig(partial)).toThrow(/les trois, ou aucune/);
    }
    for (const wrong of [
      { ...all, VAPID_PRIVATE_KEY: '' },
      { ...all, VAPID_SUBJECT: '' },
      { ...OK, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: 'mailto:contact@exemple.sn' },
      { ...all, VAPID_PRIVATE_KEY: 'trop-courte' },
      { ...all, VAPID_SUBJECT: 'contact@exemple.sn' },
      { ...all, VAPID_SUBJECT: 'http://yaar.exemple.sn' },
    ]) {
      expect(() => loadAppConfig(wrong)).toThrow(/VAPID/);
      expect(() => loadAppConfig(wrong)).not.toThrow(new RegExp(privateKey));
    }
  });

  // Spec: backlog M.1 — le volume des médias (architecture §7)
  it('sans MEDIA_PATH, ou avec un chemin relatif, la configuration est refusée et le message nomme la variable', () => {
    for (const path of [undefined, '', 'data/medias', '../medias']) {
      expect(() => loadAppConfig({ ...OK, MEDIA_PATH: path })).toThrow(/MEDIA_PATH/);
    }
  });

  // Spec: backlog D.4, E.8 — les scripts de l'éditeur tournent dans la tâche de migration, qui n'a pas le secret des jetons
  it("un script de l'éditeur ne lit que l'adresse de la base : il tourne sans JWT_SECRET, et refuse une adresse absente ou fausse comme l'API", () => {
    expect(loadDatabaseUrl({ DATABASE_URL: UNE_BASE })).toBe(UNE_BASE);
    for (const env of [{}, { DATABASE_URL: '' }, { DATABASE_URL: 'mysql://yaar:s3cr3t-de-test@db/yaar' }]) {
      expect(() => loadDatabaseUrl(env)).toThrow(/DATABASE_URL/);
      expect(() => loadDatabaseUrl(env)).not.toThrow(/s3cr3t/);
    }
  });

  it('sans DATABASE_URL, la configuration est refusée et le message nomme la variable', () => {
    for (const env of [{ JWT_SECRET: UN_SECRET }, { DATABASE_URL: '', JWT_SECRET: UN_SECRET }, { DATABASE_URL: '   ', JWT_SECRET: UN_SECRET }]) {
      expect(() => loadAppConfig(env)).toThrow(/DATABASE_URL/);
    }
  });

  it("une adresse qui n'est pas celle d'un PostgreSQL est refusée", () => {
    for (const url of ['mysql://yaar@db/yaar', 'db:5432/yaar', 'https://db.example/yaar']) {
      expect(() => loadAppConfig({ DATABASE_URL: url, JWT_SECRET: UN_SECRET })).toThrow(/DATABASE_URL/);
    }
  });

  it('un refus ne répète jamais le mot de passe de la base', () => {
    const attempt = (): unknown => loadAppConfig({ DATABASE_URL: 'mysql://yaar:s3cr3t-de-test@db/yaar', JWT_SECRET: UN_SECRET, PORT: 'abc' });

    expect(attempt).toThrow();
    try {
      attempt();
    } catch (error) {
      expect(String(error)).not.toContain('s3cr3t-de-test');
    }
  });

  it("sans JWT_SECRET, ou avec un secret trop court, la configuration est refusée sans le répéter", () => {
    for (const secret of [undefined, '', 'court', 'x'.repeat(31)]) {
      const attempt = (): unknown => loadAppConfig({ DATABASE_URL: UNE_BASE, JWT_SECRET: secret });

      expect(attempt).toThrow(/JWT_SECRET/);
      if (secret !== undefined && secret !== '') {
        try {
          attempt();
        } catch (error) {
          expect(String(error)).not.toContain(secret);
        }
      }
    }
  });

  it("un port qui n'est pas un port est refusé", () => {
    for (const port of ['abc', '0', '70000', '80.5', '-1']) {
      expect(() => loadAppConfig({ ...OK, PORT: port })).toThrow(/PORT/);
    }
  });
});
