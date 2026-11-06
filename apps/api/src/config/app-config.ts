// The configuration of the API, read once from the environment and checked before anything
// starts: a missing or malformed value stops the boot instead of surfacing at the first request.
// Adapted from build-track (app-config.ts).

export type AppConfig = {
  readonly port: number;
  /** Connection string of the PostgreSQL role the API runs under. */
  readonly databaseUrl: string;
};

/** Injection token of the validated configuration. */
export const APP_CONFIG = Symbol('APP_CONFIG');

const DEFAULT_PORT = 3000;

/** Throws when the environment cannot run the API. A message never repeats a value: it may be a secret. */
export function loadAppConfig(env: Readonly<Record<string, string | undefined>>): AppConfig {
  return { databaseUrl: databaseUrlOf(env['DATABASE_URL']), port: portOf(env['PORT']) };
}

function databaseUrlOf(raw: string | undefined): string {
  if (raw === undefined || raw.trim() === '') {
    throw new Error('Configuration : DATABASE_URL est exigé (adresse postgresql:// de la base).');
  }
  if (!/^postgres(ql)?:\/\/\S+$/.test(raw)) {
    throw new Error('Configuration : DATABASE_URL doit être une adresse postgresql://.');
  }
  return raw;
}

function portOf(raw: string | undefined): number {
  if (raw === undefined || raw === '') {
    return DEFAULT_PORT;
  }
  const port = Number(raw);
  if (!/^\d+$/.test(raw) || port < 1 || port > 65_535) {
    throw new Error('Configuration : PORT doit être un port entre 1 et 65535.');
  }
  return port;
}
