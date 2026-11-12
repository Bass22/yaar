import { ViewportScroller } from '@angular/common';
import { Component, type ApplicationRef } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { Router, RouterOutlet } from '@angular/router';
import { provideAppRouter } from './app.config';

// Spec: vérification à 360 px du 2026-11-12 — un écran ouvert depuis le bas d'un autre s'ouvrait
// défilé : la question du geste de vente était cachée en haut. Chaque nouvel écran s'ouvre en haut ;
// revenir en arrière retrouve où l'on était. Le routeur ne le fait qu'au démarrage réel de
// l'application : le test en démarre une.
@Component({ template: '' })
class Blank {}

@Component({ selector: 'app-host', imports: [RouterOutlet], template: '<router-outlet />' })
class Host {}

describe('Le routeur de l’application', () => {
  let app: ApplicationRef | null = null;

  afterEach(() => {
    app?.destroy();
    document.querySelector('app-host')?.remove();
  });

  it('un nouvel écran s’ouvre en haut de la page', async () => {
    document.body.append(document.createElement('app-host'));
    app = await bootstrapApplication(Host, { providers: [provideAppRouter([{ path: 'a', component: Blank }, { path: 'b', component: Blank }])] });
    const scrolled = vi.spyOn(app.injector.get(ViewportScroller), 'scrollToPosition');
    const router = app.injector.get(Router);

    await router.navigateByUrl('/a');
    await router.navigateByUrl('/b');

    await vi.waitFor(() => expect(scrolled.mock.lastCall?.[0]).toEqual([0, 0]));
  });
});
