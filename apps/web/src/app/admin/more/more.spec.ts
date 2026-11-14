import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { IDBFactory } from 'fake-indexeddb';
import { provideHeardVoice } from '../../core/audio/testing';
import { CLOCK } from '../../core/clock';
import { OfficeQueue } from '../../core/outbox/office-queue';
import { PUSH_PLATFORM, type PushPermission, type PushPlatform } from '../../core/push/push-notifications';
import { adminRoutes } from '../admin.routes';
import { OFFICE_QUEUE } from '../office-sync';

// Spec: correctif du 2026-11-13 — l'admin se déconnecte depuis Plus : la session se ferme, l'écran
// du numéro revient ; le numéro du compte reste sur l'appareil, et ce qui attend d'être envoyé aussi.

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const token = `e30.${btoa(JSON.stringify({ sub: uuid(54), tenant: uuid(10) })).replace(/=+$/, '')}.c2ln`;
const account = JSON.stringify({ userId: uuid(54), phone: '+221770000002', role: 'admin', name: 'Le gérant', avatar: 'baobab', language: 'fr' });
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

describe('Plus, au bureau', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('yaar.session', JSON.stringify({ token, expiresAt: '2099-01-01T00:00:00.000Z', role: 'admin', account: { name: 'Le gérant', avatar: 'baobab', language: 'fr' } }));
    localStorage.setItem('yaar.account', account);
  });

  it('« Se déconnecter » ferme la session et ramène à l’écran du numéro ; le numéro du compte reste', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: 'admin', children: adminRoutes }, { path: 'sign-in', children: [] }]),
        { provide: CLOCK, useValue: { now: () => new Date('2026-11-13T10:00:00.000Z') } },
        { provide: OFFICE_QUEUE, useFactory: () => OfficeQueue.open(new IDBFactory()) },
        ...provideHeardVoice([]).providers,
      ],
    });
    const http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/admin/plus');
    await settle();
    http.match(() => true).forEach((request) => request.flush({ chef: null, sites: [] }));
    harness.detectChanges();

    (harness.routeNativeElement?.closest('app-office-shell')?.querySelector('button.sign-out') as HTMLButtonElement).click();
    await settle();

    expect(localStorage.getItem('yaar.session')).toBeNull();
    expect(localStorage.getItem('yaar.account')).toBe(account);
    expect(TestBed.inject(Router).url).toBe('/sign-in');
  });

  // Spec: backlog Y.1 — au bureau, l'accord se donne dans Plus ; se déconnecter supprime l'abonnement de l'appareil
  describe('les notifications sur cet ordinateur', () => {
    const CLE = `B${'A'.repeat(86)}`;
    const ABONNEMENT = { endpoint: 'https://fcm.googleapis.com/fcm/send/bureau', keys: { p256dh: `B${'q'.repeat(86)}`, auth: 'c2VjcmV0LWF1dGgtMTZieQ' } };
    const unNavigateur = (permission: PushPermission, answer: 'granted' | 'denied' = 'granted') => {
      let current = permission;
      const platform: PushPlatform & { unsubscribed: number } = {
        unsubscribed: 0,
        permission: () => current,
        requestPermission: async () => (current = answer),
        subscribe: async () => ABONNEMENT,
        unsubscribe: async () => {
          platform.unsubscribed += 1;
        },
      };
      return platform;
    };
    async function ouvre(platform: PushPlatform) {
      TestBed.configureTestingModule({
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          provideRouter([{ path: 'admin', children: adminRoutes }, { path: 'sign-in', children: [] }]),
          { provide: CLOCK, useValue: { now: () => new Date('2026-11-13T10:00:00.000Z') } },
          { provide: OFFICE_QUEUE, useFactory: () => OfficeQueue.open(new IDBFactory()) },
          { provide: PUSH_PLATFORM, useValue: platform },
          ...provideHeardVoice([]).providers,
        ],
      });
      const http = TestBed.inject(HttpTestingController);
      const harness = await RouterTestingHarness.create();
      await harness.navigateByUrl('/admin/plus');
      await settle();
      http.match('/api/v1/push/public-key').forEach((request) => request.flush({ publicKey: CLE }));
      http.match(() => true).forEach((request) => request.flush({ chef: null, sites: [] }));
      await settle();
      harness.detectChanges();
      const page = () => harness.routeNativeElement?.closest('app-office-shell') as HTMLElement;
      const tap = async (selector: string) => {
        (page().querySelector(selector) as HTMLButtonElement).click();
        await settle();
        harness.detectChanges();
      };
      return { http, page, tap, harness };
    }

    it('« Activer » demande l’accord du navigateur et abonne cet ordinateur ; la ligne dit ensuite « Activées »', async () => {
      const { http, page, tap, harness } = await ouvre(unNavigateur('default'));
      expect(page().querySelector('.push')?.textContent).toContain('Notifications sur cet appareil');

      await tap('.push button.enable');
      http.expectOne({ method: 'PUT', url: '/api/v1/push-subscription' }).flush(null, { status: 204, statusText: 'No Content' });
      await settle();
      harness.detectChanges();

      expect(page().querySelector('.push')?.textContent).toContain('Activées');
      expect(page().querySelector('.push button.enable')).toBeNull();
    });

    it('le navigateur refuse après « Activer » : rien n’est envoyé, et la ligne dit tout de suite où les rouvrir', async () => {
      const { http, page, tap } = await ouvre(unNavigateur('default', 'denied'));

      await tap('.push button.enable');
      http.expectNone({ method: 'PUT', url: '/api/v1/push-subscription' });
      expect(page().querySelector('.push')?.textContent).toContain('Refusées dans les réglages du navigateur');
      expect(page().querySelector('.push button.enable')).toBeNull();
    });

    it('refusées dans le navigateur : la ligne dit où les rouvrir, sans bouton qui ne marcherait pas', async () => {
      const { page } = await ouvre(unNavigateur('denied'));

      expect(page().querySelector('.push')?.textContent).toContain('Refusées dans les réglages du navigateur');
      expect(page().querySelector('.push button.enable')).toBeNull();
    });

    it('« Se déconnecter » supprime l’abonnement de cet appareil avant de fermer la session', async () => {
      const platform = unNavigateur('granted');
      const { http, tap } = await ouvre(platform);
      http.match({ method: 'PUT', url: '/api/v1/push-subscription' }).forEach((request) => request.flush(null, { status: 204, statusText: 'No Content' }));

      await tap('button.sign-out');
      const removal = http.expectOne({ method: 'DELETE', url: '/api/v1/push-subscription' });
      expect(removal.request.headers.get('Authorization')).toBe(`Bearer ${token}`);
      removal.flush(null, { status: 204, statusText: 'No Content' });
      await settle();

      expect(platform.unsubscribed).toBe(1);
      expect(localStorage.getItem('yaar.session')).toBeNull();
      expect(TestBed.inject(Router).url).toBe('/sign-in');
    });
  });
});
