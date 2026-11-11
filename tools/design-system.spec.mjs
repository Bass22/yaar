import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { bakeAll, bakeSymbol, pathPoints, SOURCE_DIR } from '../packages/design-system/tools/bake-pictograms.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const tokens = read('packages/design-system/src/tokens/_tokens.scss');
const mockup = read('journal-gardien.html');
const tokenValue = (name) => new RegExp(`--${name}:\\s*([^;]+);`).exec(tokens)?.[1].trim();
const normalised = (value) => value.toLowerCase().replace(/\s+/g, '').replace(/0\./g, '.');

// Spec: backlog H.1 — les tokens sont la source unique du style ; journal-gardien.html (:root)
describe('Tokens du design « cahier »', () => {
  it('chaque couleur de la maquette existe en token, sous son nom anglais, à la même valeur', () => {
    const names = { coquille: 'color-shell', paille: 'color-straw', mais: 'color-corn', pature: 'color-pasture', 'pature-clair': 'color-pasture-light', terre: 'color-earth', alerte: 'color-alert', 'alerte-clair': 'color-alert-light', orange: 'color-orange', 'orange-clair': 'color-orange-light', bleu: 'color-blue', encre: 'color-ink', papier: 'color-paper', kraft: 'color-kraft', 'kraft-fonce': 'color-kraft-dark', ligne: 'color-rule', marge: 'color-margin' };
    const root = /:root\{([^}]*)\}/.exec(mockup)[1];
    const declared = [...root.matchAll(/--([\w-]+):([^;]+);/g)];

    assert.equal(declared.length, Object.keys(names).length, 'tout le :root de la maquette est repris');
    for (const [, name, value] of declared) {
      assert.equal(normalised(tokenValue(names[name]) ?? ''), normalised(value), `--${name} → --${names[name]}`);
    }
  });

  it('le violet du jour passé et le post-it existent en tokens, aux valeurs de la maquette', () => {
    assert.match(mockup, /\.banner-passe\{[^}]*background:#EFEAF8;border:2px dashed #8C86B8;[^}]*color:#5F5894/);
    assert.equal(tokenValue('color-past-day'), '#5F5894');
    assert.equal(tokenValue('color-past-day-light'), '#EFEAF8');
    assert.equal(tokenValue('color-past-day-line'), '#8C86B8');
    assert.match(mockup, /\.nudge\{[^}]*background:#FCEFC9/);
    assert.equal(tokenValue('color-post-it'), '#FCEFC9');
    // The two campaigns of a site (J.1): the colours of their cards and tabs in journal-gardien-entree.html.
    assert.equal(tokenValue('color-campaign-young'), '#E8B10A');
    assert.equal(tokenValue('color-campaign-old'), '#8C6D3E');
  });

  it('ombres dures, bords tracés à la main et lignes de cahier sont des tokens réutilisables', () => {
    for (const name of ['shadow-hard', 'shadow-hard-sm', 'shadow-hard-xs', 'radius-wobble-1', 'radius-wobble-2', 'radius-wobble-3', 'radius-blob', 'notebook-lines', 'touch-target-min']) {
      assert.ok(tokenValue(name), `--${name}`);
    }
    assert.equal(tokenValue('radius-wobble-1'), '255px 18px 225px 18px / 18px 225px 18px 255px');
  });

  it("l'application charge les tokens, et coupe les animations quand le système demande moins de mouvement", () => {
    assert.match(read('apps/web/src/styles.scss'), /@use 'tokens\/tokens';/);
    assert.match(tokens, /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\{\s*animation: none !important;\s*transition: none !important;/);
  });

  it('un composant qui écrit une couleur en dur fait échouer le lint ; un token passe', async () => {
    const eslint = new ESLint({ cwd: root });
    const errors = async (path, source) => (await eslint.lintText(source, { filePath: join(root, path) }))[0].messages.filter((message) => message.ruleId === 'no-restricted-syntax');
    const component = (styles) => `import { Component } from '@angular/core';\n@Component({ selector: 'app-x', template: '', styles: \`${styles}\` })\nexport class X {}\n`;

    for (const path of ['apps/web/src/app/ui/x.ts', 'apps/web/src/app/caretaker/x.ts', 'apps/web/src/app/admin/x.ts']) {
      for (const literal of ['.a { color: #3E7C4F; }', '.a { color: #fff; }', '.a { box-shadow: 0 0 0 rgba(0, 0, 0, .3); }', '.a { color: hsl(120 50% 50%); }']) {
        assert.ok((await errors(path, component(literal))).length >= 1, `${path} : ${literal}`);
      }
      assert.deepEqual(await errors(path, component('.a { color: var(--color-pasture); }')), [], path);
    }
    assert.ok((await errors('apps/web/src/app/ui/x.ts', `export const tone = '#C84B38';\n`)).length >= 1);
    assert.deepEqual(await errors('apps/web/src/app/ui/x.ts', `export const picto = '#dead-chicken';\n`), [], "l'adresse d'un picto n'est pas une couleur");
  });
});

// Spec: backlog H.2 — les pictos sont pré-cuits au build ; CLAUDE.md §4 règle 12 (pas de filtre SVG à l'exécution)
describe('Pictos pré-cuits', () => {
  const sprite = read('packages/design-system/src/pictograms/generated/pictograms.svg');

  it('chaque picto de la maquette gardien, ceux du bureau que l’application utilise et chaque avatar existent, au tremblé déjà appliqué (la marque Yaar mise à part) — et rien d’autre', () => {
    const mockupSymbols = [...mockup.matchAll(/<symbol id="([^"]+)"/g)].map(([, id]) => id).filter((id) => id !== 'y-mini');
    const avatars = [...read('journal-gardien-entree.html').matchAll(/<symbol id="(avatar-[^"]+)"/g)].map(([, id]) => id);
    const sources = readdirSync(SOURCE_DIR).filter((file) => file.endsWith('.svg'));
    // The office's own pictos, drawn in bureau-admin-v2.html (validated on 2026-11-08), added as screens use them.
    const office = { cloche: 'bell', camion: 'truck', 'piece-f': 'coin', 'telephone-argent': 'mobile-money' };
    const officeMockup = read('bureau-admin-v2.html');

    assert.equal(avatars.length, 12, 'douze avatars (E.9, décision du 2026-11-07)');
    for (const [drawn, name] of Object.entries(office)) {
      assert.match(officeMockup, new RegExp(`<symbol id="${drawn}"`), `${drawn} est dessiné dans la maquette du bureau`);
      assert.ok(sources.includes(`${name}.svg`), name);
    }
    assert.equal(sources.length, mockupSymbols.length + avatars.length + Object.keys(office).length);
    for (const avatar of avatars) {
      assert.ok(sources.includes(`${avatar}.svg`), avatar);
      assert.match(read('packages/design-system/src/pictograms/avatars.ts'), new RegExp(`name: '${avatar}'`), `${avatar} dans la liste fermée`);
    }
    for (const file of sources) {
      const name = file.replace(/\.svg$/, '');
      assert.match(sprite, new RegExp(`<symbol id="${name}" viewBox="`), name);
    }
    // Baked: geometry became trembling paths; only <use> and <text> keep their form.
    assert.doesNotMatch(sprite, /<(circle|ellipse|rect|line|polygon|polyline)\b/);
  });

  it('le tremblé déplace chaque point de peu : le dessin reste celui de la maquette', () => {
    const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="20" fill="red"/></svg>';
    const baked = bakeSymbol('test', source);
    const d = /<path d="([^"]+)"/.exec(baked)[1];
    const points = [...d.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map(([, x, y]) => [Number(x), Number(y)]);

    assert.ok(points.length >= 16);
    for (const [x, y] of points) {
      const distance = Math.hypot(x - 32, y - 32);
      assert.ok(Math.abs(distance - 20) <= 2.5, `point ${x},${y} à ${distance.toFixed(2)} du centre`);
    }
    assert.ok(points.some(([x, y]) => Math.abs(Math.hypot(x - 32, y - 32) - 20) > 0.2), 'et il tremble bien');
    assert.match(baked, /fill="red"/);
  });

  it('les arcs, courbes et commandes relatives se lisent en points', () => {
    const [arc] = pathPoints('M42 8 a26 26 0 1 0 14 46 a22 22 0 0 1 -14 -46z');
    assert.ok(arc.closed);
    assert.ok(arc.points.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)));
    const xs = arc.points.map(([x]) => x);
    assert.ok(Math.min(...xs) < 20, 'le grand arc de la lune part bien vers la gauche');
  });

  it('le même picto source donne toujours le même tracé, et le fichier livré est à jour', () => {
    assert.equal(bakeAll().sprite, bakeAll().sprite);
    assert.equal(bakeAll().sprite, sprite);
    execFileSync(process.execPath, ['packages/design-system/tools/bake-pictograms.mjs', '--check'], { cwd: root });
  });

  it("aucun filtre SVG à l'exécution : ni dans les pictos, ni dans l'application", () => {
    assert.doesNotMatch(sprite, /<filter|filter=|feTurbulence|feDisplacementMap/);
    const files = ['apps/web/src', 'packages/design-system/src'].flatMap((folder) => readdirSync(join(root, folder), { recursive: true }).map((file) => join(folder, String(file)))).filter((file) => /\.(ts|scss|css|html|svg)$/.test(file));
    for (const file of files) {
      assert.doesNotMatch(read(file), /filter:\s*url\(|feTurbulence/, file);
    }
  });

  it('chaque picto porte un nom accessible, en français', () => {
    const labels = read('packages/design-system/src/pictograms/labels.ts');
    for (const name of bakeAll().names) {
      assert.match(labels, new RegExp(`^\\s*'?${name}'?: ['"].+['"],$`, 'm'), name);
    }
  });

  it("l'application sert les pictos et les précache", () => {
    const build = JSON.parse(read('apps/web/project.json')).targets.build.options;
    assert.ok(build.assets.some((asset) => asset.glob === 'pictograms.svg' && asset.input === 'packages/design-system/src/pictograms/generated'));
    assert.match(read('apps/web/ngsw-config.json'), /"\/pictograms\.svg"/);
  });
});

// Spec: backlog H.3, H.4, H.5 ; CLAUDE.md §4 règle 12 (on n'anime que transform et opacity)
describe('Composants du cahier', () => {
  const ui = readdirSync(join(root, 'apps/web/src/app/ui')).filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'));
  const stylesOf = (file) => /styles: `([\s\S]*?)`,/.exec(read(`apps/web/src/app/ui/${file}`))?.[1] ?? '';

  it("on n'anime que transform et opacity : ni dans les keyframes, ni dans les transitions", () => {
    for (const file of ui) {
      const styles = stylesOf(file);
      for (const [, body] of styles.matchAll(/@keyframes [\w-]+ \{([\s\S]*?\})\s*\}/g)) {
        const animated = [...body.matchAll(/([\w-]+)\s*:/g)].map(([, property]) => property);
        assert.deepEqual(animated.filter((property) => !['transform', 'opacity'].includes(property)), [], file);
      }
      for (const [, transition] of styles.matchAll(/transition:\s*([^;]+);/g)) {
        assert.match(transition, /^(transform|opacity)\b/, `${file} : transition ${transition}`);
      }
    }
  });

  it('toute cible tactile fait au moins 48 px et montre son focus', () => {
    for (const file of ['gesture-button.ts', 'counter.ts']) {
      const styles = stylesOf(file);
      assert.match(styles, /min-(block|inline)-size: var\(--touch-target-min\)/, file);
      assert.match(styles, /:focus-visible \{ outline:/, file);
    }
    assert.match(read('packages/design-system/src/tokens/_tokens.scss'), /--touch-target-min: 48px;/);
  });

  it('la pastille de synchro ne pulse pas par box-shadow', () => {
    assert.doesNotMatch(/@keyframes[\s\S]*/.exec(stylesOf('sync-badge.ts'))?.[0] ?? '', /box-shadow/);
  });
});
