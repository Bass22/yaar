import { loadAppConfig } from './app-config';

// Spec: backlog D.1 — l'API refuse de démarrer sans DATABASE_URL (configuration validée au
// démarrage) ; CLAUDE.md §4 règle 6 (fail-closed).

const UNE_BASE = 'postgresql://yaar:s3cr3t-de-test@db:5432/yaar';

describe("Configuration de l'API", () => {
  it("la configuration se lit dans l'environnement : la base, et le port (3000 par défaut)", () => {
    expect(loadAppConfig({ DATABASE_URL: UNE_BASE })).toEqual({ databaseUrl: UNE_BASE, port: 3000 });
    expect(loadAppConfig({ DATABASE_URL: UNE_BASE, PORT: '8081' })).toEqual({ databaseUrl: UNE_BASE, port: 8081 });
  });

  it('sans DATABASE_URL, la configuration est refusée et le message nomme la variable', () => {
    for (const env of [{}, { DATABASE_URL: '' }, { DATABASE_URL: '   ' }]) {
      expect(() => loadAppConfig(env)).toThrow(/DATABASE_URL/);
    }
  });

  it("une adresse qui n'est pas celle d'un PostgreSQL est refusée", () => {
    for (const url of ['mysql://yaar@db/yaar', 'db:5432/yaar', 'https://db.example/yaar']) {
      expect(() => loadAppConfig({ DATABASE_URL: url })).toThrow(/DATABASE_URL/);
    }
  });

  it('un refus ne répète jamais le mot de passe de la base', () => {
    const attempt = (): unknown => loadAppConfig({ DATABASE_URL: 'mysql://yaar:s3cr3t-de-test@db/yaar', PORT: 'abc' });

    expect(attempt).toThrow();
    try {
      attempt();
    } catch (error) {
      expect(String(error)).not.toContain('s3cr3t-de-test');
    }
  });

  it("un port qui n'est pas un port est refusé", () => {
    for (const port of ['abc', '0', '70000', '80.5', '-1']) {
      expect(() => loadAppConfig({ DATABASE_URL: UNE_BASE, PORT: port })).toThrow(/PORT/);
    }
  });
});
