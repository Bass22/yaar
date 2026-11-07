import { appRoutes } from './app.routes';

// Spec: backlog G.1 — les routes gardien et admin sont chargées séparément ; CLAUDE.md §3
// (la vue gardien est un bundle minimal, la vue admin n'est jamais dans son code).
describe("Table des routes de l'application", () => {
  it('la vue gardien et la vue admin sont chacune chargées à la demande, jamais avec la coquille', () => {
    for (const path of ['caretaker', 'admin']) {
      const route = appRoutes.find((candidate) => candidate.path === path);
      expect(route?.loadChildren).toBeTypeOf('function');
      expect(route?.component).toBeUndefined();
      expect(route?.children).toBeUndefined();
    }
  });

  it('les deux vues se chargent bien, chacune avec ses propres routes', async () => {
    for (const path of ['caretaker', 'admin']) {
      // A lazy module hands its routes over as its default export, which the router reads.
      const loaded = (await appRoutes.find((candidate) => candidate.path === path)?.loadChildren?.()) as { default?: unknown };
      expect(Array.isArray(loaded.default)).toBe(true);
    }
  });
});
