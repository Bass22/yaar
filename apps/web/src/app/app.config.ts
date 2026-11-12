import { ApplicationConfig, inject, isDevMode, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideRouter, withInMemoryScrolling, type Routes } from '@angular/router';
import type { EnvironmentProviders } from '@angular/core';
import { provideServiceWorker } from '@angular/service-worker';
import { appRoutes } from './app.routes';
import { requestPersistentStorage } from './core/persistent-storage';
import { JournalSync } from './core/sync/journal-sync';

/** Each new screen opens at the top; going back finds where one was. */
export const provideAppRouter = (routes: Routes): EnvironmentProviders => provideRouter(routes, withInMemoryScrolling({ scrollPositionRestoration: 'enabled' }));

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideAppRouter(appRoutes),
    provideHttpClient(withFetch()),
    // Offline start after a first visit (G.1). Registered once the app is stable, so that it
    // never slows the first screen; not in development, where it would cache stale code.
    provideServiceWorker('ngsw-worker.js', { enabled: !isDevMode(), registrationStrategy: 'registerWhenStable:30000' }),
    // Not awaited: the answer never blocks the start.
    provideAppInitializer(() => void requestPersistentStorage(globalThis.navigator?.storage)),
    // The outbox leaves at opening, then whenever the network comes back (G.4).
    provideAppInitializer(() => void inject(JournalSync)),
  ],
};
