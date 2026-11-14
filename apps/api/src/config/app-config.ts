// The configuration of the API, read once from the environment and checked before anything
// starts: a missing or malformed value stops the boot instead of surfacing at the first request.
// Adapted from build-track (app-config.ts).

export type AppConfig = {
  readonly port: number;
  /** Connection string of the PostgreSQL role the API runs under. */
  readonly databaseUrl: string;
  /** Signs the session tokens. At least 32 characters, drawn at random, never shared. */
  readonly jwtSecret: string;
  /** The media volume (M.1): an absolute path, where files are kept under their fingerprint. */
  readonly mediaPath: string;
  /** The public VAPID key the browsers subscribe with (Y.1); `null`: notifications are not offered. */
  readonly vapidPublicKey: string | null;
  /** Signs what the server sends (Y.2a): never leaves the server; set with the public key and the subject, or none. */
  readonly vapidPrivateKey?: string | null;
  /** Who runs the server, for the push services (`mailto:` or `https:`). */
  readonly vapidSubject?: string | null;
};

/** Injection token of the validated configuration. */
export const APP_CONFIG = Symbol('APP_CONFIG');

const DEFAULT_PORT = 3000;

/** Throws when the environment cannot run the API. A message never repeats a value: it may be a secret. */
export function loadAppConfig(env: Readonly<Record<string, string | undefined>>): AppConfig {
  return { databaseUrl: databaseUrlOf(env['DATABASE_URL']), jwtSecret: jwtSecretOf(env['JWT_SECRET']), port: portOf(env['PORT']), mediaPath: mediaPathOf(env['MEDIA_PATH']), ...vapidOf(env) };
}

/**
 * The address of the database, alone: what the operator's scripts need (bootstrap-tenant,
 * add-admin). They run in the migration task, which never gets the secret of the tokens.
 */
export function loadDatabaseUrl(env: Readonly<Record<string, string | undefined>>): string {
  return databaseUrlOf(env['DATABASE_URL']);
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

function mediaPathOf(raw: string | undefined): string {
  if (raw === undefined || !raw.startsWith('/')) {
    throw new Error('Configuration : MEDIA_PATH est exigé, un chemin absolu vers le volume des médias (par exemple /data/medias).');
  }
  return raw;
}

// An uncompressed P-256 point (65 bytes, 0x04 first) in base64url without padding: 87 characters.
const VAPID_PUBLIC_KEY = /^B[A-Za-z0-9_-]{86}$/;

// The private scalar of P-256 (32 bytes) in base64url; the subject, a mail or a web address.
const VAPID_PRIVATE_KEY = /^[A-Za-z0-9_-]{43}$/;
const VAPID_SUBJECT = /^(mailto:\S+@\S+|https:\/\/\S+)$/;

/** The three together, or none: notifications are then neither offered nor sent (fail-closed). */
function vapidOf(env: Readonly<Record<string, string | undefined>>): Pick<AppConfig, 'vapidPublicKey' | 'vapidPrivateKey' | 'vapidSubject'> {
  const present = (value: string | undefined): string | null => (value === undefined || value === '' ? null : value);
  const publicKey = present(env['VAPID_PUBLIC_KEY']);
  const privateKey = present(env['VAPID_PRIVATE_KEY']);
  const subject = present(env['VAPID_SUBJECT']);
  if (publicKey === null && privateKey === null && subject === null) return { vapidPublicKey: null, vapidPrivateKey: null, vapidSubject: null };
  if (publicKey === null || privateKey === null || subject === null) {
    throw new Error('Configuration : VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY et VAPID_SUBJECT vont ensemble — les trois, ou aucune.');
  }
  if (!VAPID_PUBLIC_KEY.test(publicKey)) {
    throw new Error('Configuration : VAPID_PUBLIC_KEY doit être une clé publique P-256 en base64url (node tools/vapid-keys.mjs en donne une paire).');
  }
  if (!VAPID_PRIVATE_KEY.test(privateKey)) {
    throw new Error('Configuration : VAPID_PRIVATE_KEY doit être la clé privée P-256 en base64url donnée avec la clé publique.');
  }
  if (!VAPID_SUBJECT.test(subject)) {
    throw new Error('Configuration : VAPID_SUBJECT doit être un contact de l’exploitant, mailto:… ou https://…');
  }
  return { vapidPublicKey: publicKey, vapidPrivateKey: privateKey, vapidSubject: subject };
}

const SHORTEST_SECRET = 32;

function jwtSecretOf(raw: string | undefined): string {
  if (raw === undefined || raw.length < SHORTEST_SECRET) {
    throw new Error(`Configuration : JWT_SECRET est exigé, avec au moins ${SHORTEST_SECRET} caractères (par exemple : openssl rand -hex 32).`);
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
