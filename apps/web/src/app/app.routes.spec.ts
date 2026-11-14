import { appRoutes } from './app.routes';
import { caretakerRoutes } from './caretaker/caretaker.routes';
import { SignInPage } from './core/session/sign-in';

// Spec: backlog G.1 — la vue admin n'est jamais dans le code du gardien ; CLAUDE.md §3 (la vue
// gardien est un bundle minimal). Et backlog Z.1 — le budget de performance : en 3G, découvrir le
// cahier ou l'écran du numéro seulement quand la route est choisie coûte un ou deux allers-retours,
// jusqu'à une seconde de démarrage ; ils partent donc avec les premiers fichiers.
describe("Table des routes de l'application", () => {
  it('la vue admin est chargée à la demande, jamais avec les premiers fichiers', () => {
    const admin = appRoutes.find((candidate) => candidate.path === 'admin');
    expect(admin?.loadChildren).toBeTypeOf('function');
    expect(admin?.component).toBeUndefined();
    expect(admin?.children).toBeUndefined();
  });

  it('la vue admin se charge bien, avec ses propres routes', async () => {
    // A lazy module hands its routes over as its default export, which the router reads.
    const loaded = (await appRoutes.find((candidate) => candidate.path === 'admin')?.loadChildren?.()) as { default?: unknown };
    expect(Array.isArray(loaded.default)).toBe(true);
  });

  it('le cahier du gardien et l’écran du numéro partent avec les premiers fichiers (Z.1), le cahier gardé par le rôle', () => {
    const caretaker = appRoutes.find((candidate) => candidate.path === 'caretaker');
    expect(caretaker?.children).toBe(caretakerRoutes);
    expect(caretaker?.loadChildren).toBeUndefined();
    expect(caretaker?.canMatch).toHaveLength(1);
    expect(appRoutes.find((candidate) => candidate.path === 'sign-in')?.component).toBe(SignInPage);
  });
});
