import { ApplicationConfig, inject, isDevMode, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { appRoutes } from './app.routes';
import { requestPersistentStorage } from './core/persistent-storage';
import { JournalSync } from './core/sync/journal-sync';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes),
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
