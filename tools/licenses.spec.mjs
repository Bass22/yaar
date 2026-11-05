import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { isForbiddenLicense, refusedDependencies } from './licenses.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Spec: CLAUDE.md §8 — projet propriétaire, aucune dépendance sous GPL ou AGPL ; backlog A.4
describe('Licences des dépendances', () => {
  it('une licence GPL ou AGPL est refusée', () => {
    for (const license of ['GPL-3.0-only', 'GPL-2.0', 'AGPL-3.0-or-later', 'GPL-2.0-only WITH Classpath-exception-2.0']) {
      assert.equal(isForbiddenLicense(license), true, license);
    }
  });

  it('une licence permissive est acceptée, LGPL comprise', () => {
    for (const license of ['MIT', 'ISC', 'Apache-2.0', 'BSD-3-Clause', '0BSD', 'BlueOak-1.0.0', 'LGPL-3.0-only']) {
      assert.equal(isForbiddenLicense(license), false, license);
    }
  });

  it('une double licence est acceptée si l’un des choix est permis', () => {
    assert.equal(isForbiddenLicense('(MIT OR GPL-3.0-only)'), false);
    assert.equal(isForbiddenLicense('(GPL-2.0-only OR AGPL-3.0-only)'), true);
    assert.equal(isForbiddenLicense('(MIT AND GPL-3.0-only)'), true);
  });

  it('une dépendance sous GPL est signalée, même indirecte ou de développement', () => {
    // Given un verrou où une sous-dépendance de développement est sous GPL
    const lock = {
      packages: {
        '': { name: 'yaar', license: 'SEE LICENSE IN LICENSE' },
        'node_modules/fine': { version: '1.0.0', license: 'MIT' },
        'node_modules/fine/node_modules/viral': { version: '2.1.0', license: 'GPL-3.0-only', dev: true },
      },
    };

    // When
    const refused = refusedDependencies(lock, () => undefined);

    // Then
    assert.deepEqual(refused, [{ path: 'node_modules/fine/node_modules/viral', license: 'GPL-3.0-only' }]);
  });

  it('une dépendance sans licence connue est refusée ; l’ancien champ `licenses` du paquet est lu', () => {
    const lock = {
      packages: {
        'node_modules/silent': { version: '1.0.0' },
        'node_modules/legacy': { version: '1.0.0' },
      },
    };
    const readManifest = (path) =>
      path === 'node_modules/legacy' ? { licenses: [{ type: 'MIT', url: 'https://example.test' }] } : {};

    const refused = refusedDependencies(lock, readManifest);

    assert.deepEqual(refused, [{ path: 'node_modules/silent', license: 'inconnue' }]);
  });

  it('aucune dépendance du verrou n’est sous GPL, AGPL ou licence inconnue', () => {
    const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
    const readManifest = (path) => JSON.parse(readFileSync(join(root, path, 'package.json'), 'utf8'));

    assert.ok(Object.keys(lock.packages).length > 100);
    assert.deepEqual(refusedDependencies(lock, readManifest), []);
  });
});
