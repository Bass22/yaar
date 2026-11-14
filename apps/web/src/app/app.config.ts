import { ApplicationConfig, inject, isDevMode, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideRouter, withInMemoryScrolling, type Routes } from '@angular/router';
import type { EnvironmentProviders } from '@angular/core';
import { provideServiceWorker, SwUpdate } from '@angular/service-worker';
import { appRoutes } from './app.routes';
import { busyIn, watchForUpdates } from './core/app-update';
import { requestPersistentStorage } from './core/persistent-storage';
import { sessionRefused } from './core/session/session-refused';
import { JournalSync } from './core/sync/journal-sync';

/** Each new screen opens at the top; going back finds where one was. */
export const provideAppRouter = (routes: Routes): EnvironmentProviders => provideRouter(routes, withInMemoryScrolling({ scrollPositionRestoration: 'enabled' }));

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideAppRouter(appRoutes),
    // A session the server refuses brings the sign-in back, never « no network ».
    provideHttpClient(withFetch(), withInterceptors([sessionRefused])),
    // Offline start after a first visit (G.1). Registered once the app is stable, so that it
    // never slows the first screen; not in development, where it would cache stale code.
    provideServiceWorker('ngsw-worker.js', { enabled: !isDevMode(), registrationStrategy: 'registerWhenStable:30000' }),
    // Not awaited: the answer never blocks the start.
    provideAppInitializer(() => void requestPersistentStorage(globalThis.navigator?.storage)),
    // The outbox leaves at opening, then whenever the network comes back (G.4).
    provideAppInitializer(() => void inject(JournalSync)),
    // A new version is taken when nobody uses the app, never during a gesture (Z.5).
    provideAppInitializer(() => {
      const updates = inject(SwUpdate);
      if (!updates.isEnabled) return;
      watchForUpdates(updates, {
        visible: () => document.visibilityState === 'visible',
        busy: () => busyIn(document),
        onVisibilityChange: (listener) => document.addEventListener('visibilitychange', listener),
        reload: () => location.reload(),
      });
    }),
  ],
};
