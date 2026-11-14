import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

// Spec: correctif du 2026-11-13 — une session refusée ramène à l'écran du numéro. La règle vit dans
// un intercepteur (apps/web/src/app/core/session/session-refused.ts, testé à part) ; ici, la preuve
// que l'application le branche sur toutes ses requêtes.
describe("La configuration de l'application web", () => {
  it('branche l’intercepteur des sessions refusées sur son client HTTP', () => {
    const config = readFileSync(new URL('../apps/web/src/app/app.config.ts', import.meta.url), 'utf8');
    assert.match(config, /provideHttpClient\(.*withInterceptors\(\[sessionRefused\]\)\)/);
  });
});
