import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const json = (path) => JSON.parse(read(path));

// PNG files start with a fixed signature, and give their size in the IHDR chunk.
function pngSize(path) {
  const bytes = readFileSync(join(root, path));
  assert.equal(bytes.subarray(1, 4).toString('latin1'), 'PNG', `${path} est un PNG`);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

// Spec: backlog G.1 — l'application s'installe et démarre sans réseau ; Archi §5 « Service worker »
describe('Application installable, hors-ligne', () => {
  it("le manifeste installe l'application sur l'écran d'accueil, avec ses icônes 192 et 512 px masquables", () => {
    const manifest = json('apps/web/public/manifest.webmanifest');

    assert.equal(manifest.name, 'Yaar', 'le nom de travail ne s’écrit qu’ici');
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.start_url, '/');
    assert.equal(manifest.background_color, '#1E4530');
    for (const size of [192, 512]) {
      const icon = manifest.icons.find((candidate) => candidate.sizes === `${size}x${size}`);
      assert.ok(icon, `icône ${size}`);
      assert.match(icon.purpose, /maskable/);
      assert.deepEqual(pngSize(`apps/web/public/${icon.src}`), [size, size]);
    }
    assert.match(read('apps/web/src/index.html'), /<link rel="manifest" href="manifest\.webmanifest"/);
  });

  it("le service worker est construit avec l'application et enregistré par elle", () => {
    const build = json('apps/web/project.json').targets.build;

    assert.equal(build.configurations.production.serviceWorker, 'apps/web/ngsw-config.json');
    assert.match(read('apps/web/src/app/app.config.ts'), /provideServiceWorker\('ngsw-worker\.js'/);
  });

  it("le service worker précache la coquille, son code, ses styles et ses polices : après une première visite, elle démarre sans réseau", () => {
    const config = json('apps/web/ngsw-config.json');
    const prefetched = config.assetGroups.filter((group) => group.installMode === 'prefetch').flatMap((group) => group.resources.files ?? []);

    for (const pattern of ['/index.html', '/manifest.webmanifest', '/*.css', '/*.js', '/media/*.woff2']) {
      assert.ok(prefetched.includes(pattern), `précaché : ${pattern}`);
    }
    assert.equal(config.index, '/index.html');
  });

  it("Caddy ne met jamais en cache le service worker ni son index : sinon les téléphones resteraient sur une ancienne version", () => {
    const volatile = /@volatile path ([^\n]+)/.exec(read('infra/caddy/Caddyfile'))?.[1]?.split(' ') ?? [];

    for (const path of ['/index.html', '/ngsw-worker.js', '/ngsw.json', '/manifest.webmanifest']) {
      assert.ok(volatile.includes(path), `jamais en cache : ${path}`);
    }
  });

  it("les polices sont servies par l'application, jamais par un CDN", () => {
    const sources = ['apps/web/src/index.html', 'apps/web/src/styles.scss'].map(read).join('\n');

    assert.doesNotMatch(sources, /fonts\.googleapis|fonts\.gstatic|cdn\.|unpkg|jsdelivr/i);
    for (const font of ['andika', 'shantell-sans']) {
      assert.match(read('apps/web/src/styles.scss'), new RegExp(`@use '@fontsource/${font}/`), font);
      assert.ok(existsSync(join(root, `node_modules/@fontsource/${font}/package.json`)), `${font} installée`);
    }
  });
});
