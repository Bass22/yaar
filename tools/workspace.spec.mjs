import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

const IGNORED_DIRS = new Set(['node_modules', 'dist', '.git', '.nx', '.angular', '.idea']);

function findFiles(dir, matches) {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return IGNORED_DIRS.has(entry.name) ? [] : findFiles(join(dir, entry.name), matches);
    }
    return matches(entry.name) ? [join(dir, entry.name)] : [];
  });
}

const named = (expected) => (name) => name === expected;
const isTypeScript = (name) => name.endsWith('.ts');
const isSpec = (file) => file.endsWith('.spec.ts');

function importedModules(file) {
  const source = readFileSync(file, 'utf8');
  const specifiers = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*['"]([^'"]+)['"]/g;
  return [...source.matchAll(specifiers)].map((match) => match[1]);
}

// Spec: backlog A.1 — le workspace démarre, teste et compile en strict
describe('Structure du workspace', () => {
  it('le monorepo contient les deux applications et les trois packages', () => {
    const projects = ['apps/web', 'apps/api', 'packages/domain', 'packages/contracts', 'packages/design-system'];

    for (const project of projects) {
      assert.ok(existsSync(join(root, project, 'project.json')), `projet Nx manquant : ${project}`);
    }
  });

  it('TypeScript est strict pour tous les projets', () => {
    const { compilerOptions } = readJson(join(root, 'tsconfig.base.json'));

    assert.equal(compilerOptions.strict, true);
    assert.equal(compilerOptions.noUncheckedIndexedAccess, true);
  });

  it('chaque projet hérite de la configuration TypeScript commune', () => {
    const projectRoots = findFiles(root, named('project.json')).map(dirname);

    for (const projectRoot of projectRoots) {
      const { extends: parent } = readJson(join(projectRoot, 'tsconfig.json'));
      assert.equal(parent, '../../tsconfig.base.json', relative(root, projectRoot));
    }
  });

  it('chaque projet a une cible de test', () => {
    for (const file of findFiles(root, named('project.json'))) {
      assert.ok(readJson(file).targets?.test, `cible test manquante : ${relative(root, file)}`);
    }
  });

  it('tout package.json est privé et renvoie à la licence propriétaire', () => {
    const manifests = findFiles(root, named('package.json'));
    assert.ok(manifests.length >= 1);

    for (const file of manifests) {
      const manifest = readJson(file);
      assert.equal(manifest.private, true, `${relative(root, file)} doit être privé`);
      assert.equal(manifest.license, 'SEE LICENSE IN LICENSE', relative(root, file));
    }
  });
});

// Spec: backlog A.5 — le kit maison existe et ne dépend de rien
describe('Kit maison', () => {
  const kitRoot = join(root, 'packages/kit');
  const kitSourceRoot = join(kitRoot, 'src');
  const kitSources = () => findFiles(kitSourceRoot, isTypeScript);

  it('le kit est un projet du workspace, testé avec Vitest comme les autres packages', () => {
    const project = readJson(join(kitRoot, 'project.json'));

    assert.equal(project.name, 'kit');
    assert.match(project.targets.test.options.command, /^vitest run --root packages\/kit( |$)/);
    assert.ok(kitSources().some(isSpec), 'le kit a au moins un test');
  });

  it("le kit n'importe que ses propres fichiers", () => {
    // Given
    const sources = kitSources();
    assert.ok(sources.length >= 1);

    for (const file of sources) {
      // When
      const outsiders = importedModules(file).filter((specifier) => {
        if (isSpec(file) && specifier === 'vitest') {
          return false;
        }
        const target = join(dirname(file), specifier);
        return !specifier.startsWith('.') || relative(kitSourceRoot, target).startsWith('..');
      });

      // Then
      assert.deepEqual(outsiders, [], `import étranger dans ${relative(root, file)}`);
    }
  });

  it('le README note la provenance de chaque brique reprise', () => {
    // Given
    const readme = readFileSync(join(kitRoot, 'README.md'), 'utf8');
    const bricks = kitSources().filter((file) => !isSpec(file) && !file.endsWith('index.ts'));

    assert.match(readme, /build-track/);

    for (const brick of bricks) {
      // When
      const name = relative(kitSourceRoot, brick);
      const row = readme.split('\n').find((line) => line.includes(`\`${name}\``));

      // Then
      assert.ok(row, `${name} n'a pas de ligne de provenance`);
      assert.match(row, /\b[0-9a-f]{7,40}\b/, `${name} : révision build-track manquante`);
    }
  });
});

// Spec: backlog A.2 — les frontières de dépendance ; CLAUDE.md §3
describe('Points d\'entrée et code isomorphe', () => {
  const { compilerOptions: base } = readJson(join(root, 'tsconfig.base.json'));

  it('le domaine a deux points d\'entrée, journal et finance', () => {
    assert.deepEqual(base.paths['@domain/journal'], ['./packages/domain/src/journal/index.ts']);
    assert.deepEqual(base.paths['@domain/finance'], ['./packages/domain/src/finance/index.ts']);
    assert.equal(base.paths['@domain'], undefined, 'pas de point d\'entrée qui mêle journal et finance');
    assert.equal(base.paths['@domain/*'], undefined, 'pas d\'import profond dans le domaine');
  });

  it('chaque alias du workspace mène à un fichier qui existe', () => {
    const aliases = Object.entries(base.paths);
    assert.ok(aliases.length >= 3);

    for (const [alias, targets] of aliases) {
      assert.equal(targets.length, 1, alias);
      assert.ok(existsSync(join(root, targets[0])), `${alias} → ${targets[0]}`);
    }
  });

  it('Nx suit les imports entre projets, pour le cache et pour `affected`', () => {
    const nx = readJson(join(root, 'nx.json'));

    assert.equal(nx.pluginsConfig['@nx/js'].analyzeSourceFiles, true);
  });

  it('le code livré du kit et du domaine se compile sans les types de Node ni du navigateur', () => {
    for (const name of ['kit', 'domain']) {
      const projectRoot = join(root, 'packages', name);
      const project = readJson(join(projectRoot, 'project.json'));
      const shipped = readJson(join(projectRoot, 'tsconfig.lib.json'));
      const common = readJson(join(projectRoot, 'tsconfig.json'));

      assert.match(project.targets.typecheck.options.command, /tsconfig\.lib\.json/, name);
      assert.equal(shipped.extends, './tsconfig.json', name);
      assert.ok(shipped.exclude.includes('src/**/*.spec.ts'), `${name} : les tests chargent les types de Node via Vitest`);
      assert.deepEqual(common.compilerOptions.types, [], name);
      assert.equal(common.compilerOptions.lib, undefined, name);
    }
    assert.deepEqual(base.lib, ['es2022']);
  });
});
