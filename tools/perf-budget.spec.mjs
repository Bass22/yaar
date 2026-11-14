import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { BUDGET, FIELD_PHONE, FINANCE_MARKERS, SCENARIOS, verdict } from './perf-budget.mjs';

// Spec: backlog Z.1 — le budget de performance tenu par la CI ; CLAUDE.md règle 12 ; architecture §4
// (démarrage < 2,5 s en 3G, route gardien < 200 Ko gzip, rien de domain/finance chez le gardien).
// La mesure elle-même tourne sur le build, dans Chrome (node tools/perf-budget.mjs) ; ici, ce qu'elle juge.

const tenu = { starts: { 'Le matin, après une mise à jour': 2_300, 'La toute première ouverture': 2_000 }, routeBytes: 123 * 1024, financeFiles: [] };

describe('Le budget de performance de la vue gardien', () => {
  it('les seuils : 2,5 s et 200 Ko gzip', () => {
    assert.deepEqual(BUDGET, { startupMs: 2_500, routeBytes: 200 * 1024 });
  });

  it('le téléphone du terrain : le réseau « 3G » de Chrome et un processeur quatre fois plus lent', () => {
    assert.deepEqual(FIELD_PHONE, { latency: 562.5, downloadThroughput: 209_715.2, uploadThroughput: 96_000, cpuSlowdown: 4 });
  });

  it('deux démarrages comptent : le matin, cahier gardé ; la toute première ouverture, sur l’écran du numéro', () => {
    assert.deepEqual(
      SCENARIOS.map(({ name, ready, path }) => ({ name, ready, path })),
      [
        { name: 'Le matin, après une mise à jour', ready: 'app-day-strip', path: '/caretaker' },
        { name: 'La toute première ouverture', ready: 'app-sign-in button.go', path: '/sign-in' },
      ],
    );
  });

  it('sous les seuils, rien à redire', () => {
    assert.deepEqual(verdict(tenu), []);
  });

  it('un démarrage à 2,5 s pile ne tient pas : le budget est « moins de »', () => {
    assert.deepEqual(verdict({ ...tenu, starts: { ...tenu.starts, 'Le matin, après une mise à jour': 2_500 } }), ['Le matin, après une mise à jour : 2500 ms, au-delà de 2500 ms en 3G.']);
  });

  it('chaque démarrage est jugé, pas seulement le premier', () => {
    assert.equal(verdict({ ...tenu, starts: { ...tenu.starts, 'La toute première ouverture': 3_100 } }).length, 1);
  });

  it('une route gardien de 200 Ko gzip ou plus ne tient pas', () => {
    assert.deepEqual(verdict({ ...tenu, routeBytes: 200 * 1024 }), ['Fichiers de la route gardien : 200.0 Ko gzip, au-delà de 200.0 Ko.']);
  });

  it('un seul fichier du gardien qui porte du code de domain/finance fait échouer', () => {
    assert.deepEqual(verdict({ ...tenu, financeFiles: ['/chunk-X.js'] }), ['Du code de domain/finance dans la vue gardien : /chunk-X.js.']);
  });

  it('les marques de domain/finance sont des chaînes que seul domain/finance écrit', () => {
    const sources = (dir) => readdirSync(new URL(`../${dir}`, import.meta.url), { recursive: true }).filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts')).map((file) => readFileSync(new URL(`../${dir}/${file}`, import.meta.url), 'utf8'));
    const finance = sources('packages/domain/src/finance').join('\n');
    const phone = ['packages/domain/src/journal', 'packages/kit/src', 'apps/web/src/app/caretaker', 'apps/web/src/app/core', 'apps/web/src/app/ui'].flatMap(sources).join('\n');
    for (const marker of FINANCE_MARKERS) {
      assert.ok(finance.includes(`'${marker}'`), `${marker} n'est plus écrit par domain/finance`);
      assert.ok(!phone.includes(marker), `${marker} est aussi écrit hors de domain/finance`);
    }
  });
});
