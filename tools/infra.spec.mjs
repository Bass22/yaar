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

  it('le compose démarre le web derrière Caddy, l’API et PostgreSQL', () => {
    assert.deepEqual([...services.keys()].sort(), ['api', 'db', 'web']);
    assert.match(services.get('db').lines.join('\n'), /image: postgres:\d+/);
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
      assert.match(value, /^\$\{[A-Z0-9_]+:\?[^}]+\}$/, `${name} doit être exigé de l'environnement`);
    }
    assert.doesNotMatch(compose, /:\/\/[^:\s$]+:[^$@\s]+@/, 'aucun mot de passe en clair dans une URL');
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

    assert.match(api, /^USER node$/m, "l'API ne tourne pas en root");
    assert.match(api, /npm ci --omit=dev/, "l'image de l'API n'embarque pas les dépendances de développement");
    assert.match(web, /^FROM caddy:/m, 'le web livré ne contient que Caddy et des fichiers statiques');
  });
});
