import { loadAppConfig, loadDatabaseUrl } from './app-config';

// Spec: backlog D.1 — l'API refuse de démarrer sans DATABASE_URL (configuration validée au
// démarrage) ; CLAUDE.md §4 règle 6 (fail-closed).

const UNE_BASE = 'postgresql://yaar:s3cr3t-de-test@db:5432/yaar';
const UN_SECRET = 'un-secret-de-test-assez-long-pour-signer-des-jetons';
const OK = { DATABASE_URL: UNE_BASE, JWT_SECRET: UN_SECRET, MEDIA_PATH: '/data/medias' };

describe("Configuration de l'API", () => {
  it("la configuration se lit dans l'environnement : la base, et le port (3000 par défaut)", () => {
    expect(loadAppConfig(OK)).toEqual({ databaseUrl: UNE_BASE, jwtSecret: UN_SECRET, port: 3000, mediaPath: '/data/medias' });
    expect(loadAppConfig({ ...OK, PORT: '8081' })).toEqual({ databaseUrl: UNE_BASE, jwtSecret: UN_SECRET, port: 8081, mediaPath: '/data/medias' });
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
