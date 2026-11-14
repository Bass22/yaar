import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

// Reads our own compose file: services are the keys indented by two spaces under `services:`,
// their settings the keys indented by four. Enough for this file; not a YAML parser.
function composeServices(source) {
  const services = new Map();
  let inServices = false;
  let current;

  for (const line of source.split('\n')) {
    if (/^\S/.test(line)) {
      inServices = line.startsWith('services:');
      continue;
    }
    if (!inServices) {
      continue;
    }
    const service = /^ {2}([\w-]+):\s*$/.exec(line);
    if (service) {
      current = { keys: new Set(), lines: [] };
      services.set(service[1], current);
      continue;
    }
    const key = /^ {4}([\w-]+):/.exec(line);
    if (key) {
      current.keys.add(key[1]);
    }
    current?.lines.push(line);
  }
  return services;
}

const SECRET_NAME = /PASSWORD|SECRET|PRIVATE|TOKEN/;

// Spec: backlog A.3 — la pile tourne en conteneurs derrière une seule origine ; Archi §9
describe('Pile de conteneurs', () => {
  const compose = read('infra/docker-compose.yml');
  const services = composeServices(compose);

  it('le compose démarre le web derrière Caddy, l’API et PostgreSQL, plus une tâche de migration ; le chiffrement des sauvegardes ne démarre jamais avec la pile', () => {
    assert.deepEqual([...services.keys()].sort(), ['age', 'api', 'db', 'migrate', 'web']);
    // Z.4 : `age` n'est lancé que par infra/backup/*.sh, coupé de tout réseau
    assert.match(services.get('age').lines.join('\n'), /profiles: \['tools'\]/);
    assert.match(services.get('age').lines.join('\n'), /network_mode: none/);
    assert.match(services.get('db').lines.join('\n'), /image: postgres:\d+/);
  });

  // Spec: backlog D.1 — la migration s'applique avant l'API ; le compose fournit DATABASE_URL
  it('les migrations s’appliquent par une tâche à part, qui s’arrête, avant que l’API ne démarre', () => {
    const migrate = services.get('migrate').lines.join('\n');
    const api = services.get('api').lines.join('\n');

    assert.match(migrate, /target: migrate/, 'la tâche a sa propre étape de l’image');
    assert.match(read('infra/docker/api.Dockerfile'), /^CMD \[.*"migrate", "deploy".*\]$/m, 'elle applique les migrations du dépôt');
    assert.match(migrate, /restart: 'no'/, 'une tâche finie ne redémarre pas');
    assert.match(api, /target: runtime/);
    assert.match(migrate, /db:\n\s+condition: service_healthy/);
    assert.match(api, /migrate:\n\s+condition: service_completed_successfully/);
  });

  it('l’API et la tâche de migration reçoivent l’adresse de la base, mot de passe exigé de l’environnement', () => {
    for (const name of ['api', 'migrate']) {
      const service = services.get(name).lines.join('\n');

      assert.match(service, /DATABASE_URL: postgresql:\/\/\w+:\$\{[A-Z_]+:\?[^}]+\}@db:5432\/\w+/, name);
    }
  });

  // Spec: backlog D.2 — le rôle applicatif n'est pas propriétaire des tables ; D.6 — le propriétaire n'est pas superutilisateur
  it('trois rôles, deux mots de passe : l’API sous le rôle applicatif, les migrations et les scripts sous le propriétaire, le superutilisateur réservé au serveur de base', () => {
    const urlOf = (name) => /DATABASE_URL: (\S+)/.exec(services.get(name).lines.join('\n'))[1];
    const db = services.get('db').lines.join('\n');

    assert.match(urlOf('api'), /^postgresql:\/\/yaar_app:\$\{APP_DB_PASSWORD:\?/);
    assert.match(urlOf('migrate'), /^postgresql:\/\/yaar:\$\{DB_PASSWORD:\?/);
    assert.match(db, /POSTGRES_USER: postgres$/m, 'le superutilisateur créé par l’image n’est pas le propriétaire des tables');
    assert.match(db, /POSTGRES_PASSWORD: \$\{DB_PASSWORD:\?[^}]+\}/, 'pas de secret de plus : le superutilisateur perd ce mot de passe à l’initialisation');
    assert.doesNotMatch(compose + read('infra/.env.example'), /DB_SUPERUSER_PASSWORD/);
    assert.match(db, /DB_PASSWORD: \$\{DB_PASSWORD:\?[^}]+\}/, 'la base reçoit le mot de passe du propriétaire, pour le créer');
    assert.match(db, /APP_DB_PASSWORD: \$\{APP_DB_PASSWORD:\?[^}]+\}/, 'et celui du rôle applicatif');
    assert.match(db, /init-roles\.sh:\/docker-entrypoint-initdb\.d\/[\w.-]+:ro/, 'les rôles sont créés avec le serveur de base');
    for (const name of ['api', 'migrate', 'web']) {
      assert.doesNotMatch(services.get(name).lines.join('\n'), /POSTGRES_PASSWORD|POSTGRES_USER/, `${name} ne parle pas au superutilisateur`);
    }
    for (const name of ['DB_PASSWORD', 'APP_DB_PASSWORD']) {
      assert.match(read('infra/.env.example'), new RegExp(`^${name}=$`, 'm'));
    }
  });

  // Spec: backlog D.6 — ni le propriétaire ni le rôle applicatif ne sont superutilisateurs
  it('le script d’initialisation crée le propriétaire et le rôle applicatif sans aucun privilège de plus, puis la base au nom du propriétaire', () => {
    const init = read('infra/postgres/init-roles.sh');
    const roleOf = (name) => new RegExp(`CREATE ROLE ${name} LOGIN PASSWORD :'\\w+' ([A-Z ]+);`).exec(init)?.[1] ?? '';

    for (const name of ['yaar', 'yaar_app']) {
      const options = roleOf(name);
      for (const denied of ['NOSUPERUSER', 'NOBYPASSRLS', 'NOCREATEROLE', 'NOCREATEDB', 'NOREPLICATION']) {
        assert.ok(options.split(' ').includes(denied), `${name} : ${denied}`);
      }
    }
    assert.match(init, /CREATE DATABASE yaar OWNER yaar;/);
    assert.match(init, /ALTER ROLE :"superuser" PASSWORD NULL;/, 'le superutilisateur ne se connecte plus par le réseau, même avec DB_PASSWORD');
  });

  it('l’API n’est déclarée saine que si la base lui répond', () => {
    assert.match(services.get('api').lines.join('\n'), /\/api\/v1\/health\/ready/);
  });

  it('une seule porte sur l’extérieur : seul le web publie un port', () => {
    const published = [...services].filter(([, service]) => service.keys.has('ports')).map(([name]) => name);

    assert.deepEqual(published, ['web']);
  });

  it('la base n’est jointe que par l’API : le conteneur exposé n’a aucun chemin vers elle', () => {
    const networksOf = (name) =>
      services
        .get(name)
        .lines.join('\n')
        .match(/^ {4}networks:\n((?: {6}- \w+\n?)+)/m)[1]
        .split('\n')
        .map((line) => line.replace(/^ {6}- /, ''))
        .filter(Boolean);

    assert.deepEqual(networksOf('db'), ['data']);
    assert.deepEqual(networksOf('migrate'), ['data']);
    assert.deepEqual(networksOf('web'), ['edge']);
    assert.deepEqual(networksOf('api').sort(), ['data', 'edge']);
    assert.match(compose, /^ {2}data:\n(?: {4}#.*\n)* {4}internal: true$/m);
  });

  it('Caddy sert le web et relaie /api/v1 vers l’API, sans en-tête CORS', () => {
    const caddyfile = read('infra/caddy/Caddyfile');

    assert.match(caddyfile, /handle \/api\/v1\/\* \{\s*reverse_proxy api:3000\s*\}/);
    assert.match(caddyfile, /try_files \{path\} \/index\.html/);
    assert.doesNotMatch(caddyfile, /Access-Control/i);
  });

  it('les secrets viennent de l’environnement : exigés, sans valeur par défaut', () => {
    const assignments = [...compose.matchAll(/^\s+([A-Z][A-Z0-9_]*):\s*(.*)$/gm)].filter(([, name]) =>
      SECRET_NAME.test(name),
    );
    assert.ok(assignments.length >= 1, 'le mot de passe de la base est déclaré');

    for (const [, name, value] of assignments) {
      // The notification key is optional (Y.2a): without it, nothing is offered nor sent — fail-closed.
      if (name === 'VAPID_PRIVATE_KEY') {
        assert.equal(value, '${VAPID_PRIVATE_KEY:-}');
        continue;
      }
      assert.match(value, /^\$\{[A-Z0-9_]+:\?[^}]+\}$/, `${name} doit être exigé de l'environnement`);
    }
    assert.doesNotMatch(compose, /:\/\/[^:\s$]+:[^$@\s]+@/, 'aucun mot de passe en clair dans une URL');
  });

  // Spec: backlog D.4, E.8 — les scripts de l'éditeur tournent dans la tâche de migration : ils n'y trouvent que l'adresse de la base
  it("la tâche de migration ne reçoit pas le secret des jetons, et les scripts de l'éditeur ne le demandent pas", () => {
    const migrateService = /^  migrate:\n[\s\S]*?(?=^  \S)/m.exec(compose)?.[0] ?? '';

    assert.match(migrateService, /DATABASE_URL/);
    assert.doesNotMatch(migrateService, /JWT_SECRET/, 'la tâche de migration ne signe aucun jeton');
    for (const script of ['apps/api/src/bootstrap-tenant.ts', 'apps/api/src/add-admin.ts']) {
      const source = read(script);
      assert.match(source, /loadDatabaseUrl\(process\.env\)/, `${script} lit l'adresse de la base`);
      assert.doesNotMatch(source, /loadAppConfig/, `${script} ne lit pas la configuration de l'API, qui exige JWT_SECRET`);
    }
  });

  // Spec: backlog Y.1, Y.2a — la revue : la clé privée VAPID ne quitte pas l'environnement du serveur
  it('les clés des notifications et le contact vont à la seule API, facultatifs ensemble ; aucun autre conteneur ne les reçoit', () => {
    const api = /^  api:\n[\s\S]*?(?=^  \S)/m.exec(compose)?.[0] ?? '';
    for (const name of ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']) {
      assert.match(api, new RegExp(`^\\s+${name}: \\$\\{${name}:-\\}$`, 'm'));
      assert.match(read('infra/.env.example'), new RegExp(`^${name}=$`, 'm'));
    }
    for (const [name, service] of services) {
      if (name !== 'api') assert.doesNotMatch(service.lines.join('\n'), /VAPID/, `${name} ne reçoit aucune clé de notification`);
    }
  });

  it('.env.example ne contient aucune valeur réelle', () => {
    const entries = read('infra/.env.example')
      .split('\n')
      .filter((line) => line.trim() !== '' && !line.startsWith('#'))
      .map((line) => line.split('='));
    const secrets = entries.filter(([name]) => SECRET_NAME.test(name));

    assert.ok(secrets.length >= 1);
    for (const [name, ...value] of secrets) {
      assert.equal(value.join('='), '', `${name} doit rester vide dans l'exemple`);
    }
  });

  it('le fichier .env réel ne part ni dans git ni dans une image', () => {
    const gitignore = read('.gitignore').split('\n');
    const dockerignore = read('.dockerignore').split('\n');

    assert.ok(gitignore.includes('.env') && gitignore.includes('.env.*') && gitignore.includes('!.env.example'));
    assert.ok(dockerignore.includes('**/.env') && dockerignore.includes('**/.env.*'));
    assert.ok(dockerignore.includes('.git'));
  });

  it('les images tournent sans privilèges et sans outils de build', () => {
    const api = read('infra/docker/api.Dockerfile');
    const web = read('infra/docker/web.Dockerfile');

    const stage = (name) => new RegExp(`^FROM \\S+ AS ${name}$[\\s\\S]*?(?=^FROM |\\Z)`, 'm').exec(api + '\nFROM end')[0];
    const [builder, migrate, runtime] = ['builder', 'migrate', 'runtime'].map(stage);

    for (const [name, text] of [['migrate', migrate], ['runtime', runtime]]) {
      assert.match(text, /^USER node$/m, `l'étape ${name} ne tourne pas en root`);
    }
    assert.match(runtime, /npm ci --omit=dev --omit=optional/, "l'image de l'API n'embarque ni les dépendances de développement ni les facultatives");
    assert.match(builder, /prisma generate/, 'le client de la base est généré au build');
    assert.match(runtime, /COPY --from=builder \S*node_modules\/\.prisma/, "l'image de l'API reçoit le client généré");
    // Spec: backlog D.5 — la ligne de commande Prisma (et ce qu'elle embarque) reste hors de l'image livrée
    assert.doesNotMatch(runtime, /prisma (generate|migrate)|npx/, "l'image de l'API n'exécute ni n'embarque la ligne de commande Prisma");
    assert.ok(migrate.indexOf('migrate diff') < migrate.indexOf('USER node'), 'rien ne se télécharge une fois les privilèges rendus');
    // Spec: backlog D.4 — le script d'amorçage tourne dans la tâche de migration, sous le rôle propriétaire
    assert.match(migrate, /COPY --from=builder \S*dist \.\/dist/, "l'image de migration embarque le script d'amorçage");
    assert.match(migrate, /COPY --from=builder \S*node_modules\/\.prisma/, 'et le client généré dont il a besoin');
    assert.match(web, /^FROM caddy:/m, 'le web livré ne contient que Caddy et des fichiers statiques');
  });
});
