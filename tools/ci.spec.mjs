import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const nxManifest = require.resolve('nx/package.json');
const nxBin = join(dirname(nxManifest), require(nxManifest).bin.nx);
const ALL_PROJECTS = ['api', 'design-system', 'domain', 'kit', 'shared', 'web'];

// Asks Nx which projects a change to `file` touches — what `nx affected` runs in CI.
function projectsTouchedBy(file) {
  const output = execFileSync(
    process.execPath,
    [nxBin, 'show', 'projects', '--affected', `--files=${file}`, '--json'],
    { cwd: root, encoding: 'utf8', env: { ...process.env, NX_DAEMON: 'false' } },
  );
  return JSON.parse(output).sort();
}

// Spec: backlog A.4 — la CI ne laisse passer que du vert ; CLAUDE.md §3 (règle de dépendance)
describe('Ce qu’une modification déclenche', () => {
  it('un changement dans une application ne déclenche que cette application', () => {
    assert.deepEqual(projectsTouchedBy('apps/web/src/app/app.ts'), ['web']);
    assert.deepEqual(projectsTouchedBy('apps/api/src/main.ts'), ['api']);
  });

  it('un changement dans packages/domain déclenche aussi le web et l’API', () => {
    assert.deepEqual(projectsTouchedBy('packages/domain/src/journal/index.ts'), ['api', 'domain', 'web']);
  });

  it('un changement dans packages/shared déclenche aussi le web et l’API', () => {
    assert.deepEqual(projectsTouchedBy('packages/shared/src/workbench.spec.ts'), ['api', 'shared', 'web']);
  });

  it('un changement dans le kit déclenche le domaine, le web et l’API', () => {
    assert.deepEqual(projectsTouchedBy('packages/kit/src/index.ts'), ['api', 'domain', 'kit', 'web']);
  });

  it('un changement dans le design system ne déclenche que lui et le web', () => {
    assert.deepEqual(projectsTouchedBy('packages/design-system/src/workbench.spec.ts'), ['design-system', 'web']);
  });

  it('un changement de règle commune déclenche tous les projets', () => {
    for (const file of ['tsconfig.base.json', 'eslint.config.mjs', 'nx.json', 'package-lock.json']) {
      assert.deepEqual(projectsTouchedBy(file), ALL_PROJECTS, file);
    }
  });
});

describe('Pipeline de CI', () => {
  const workflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');

  it('la CI installe depuis le verrou et vérifie lint, tests, typage et build de ce qui est touché', () => {
    assert.match(workflow, /^\s+run: npm ci$/m);
    assert.match(workflow, /nx affected -t lint test typecheck build --base="\$BASE" --head=HEAD/);
    assert.match(workflow, /fetch-depth: 0/, 'la comparaison a besoin de l’historique');
  });

  it('sans base de comparaison fiable, la CI vérifie tout', () => {
    assert.match(workflow, /nx run-many -t lint test typecheck build/);
  });

  it('les règles du workspace et les licences sont vérifiées à chaque fois', () => {
    assert.match(workflow, /node --test "tools\/\*\*\/\*\.spec\.mjs"/);
  });

  it('la CI n’a que des droits de lecture et n’utilise que des actions épinglées par empreinte', () => {
    const actions = [...workflow.matchAll(/^\s+(?:- )?uses: (\S+)/gm)].map((match) => match[1]);

    assert.match(workflow, /^permissions:\n {2}contents: read$/m);
    assert.ok(actions.length >= 2);
    for (const action of actions) {
      assert.match(action, /^actions\/[\w-]+@[0-9a-f]{40}$/, `${action} doit être une action officielle épinglée`);
    }
    assert.doesNotMatch(workflow, /secrets\./, 'cette CI n’a besoin d’aucun secret');
  });
});
