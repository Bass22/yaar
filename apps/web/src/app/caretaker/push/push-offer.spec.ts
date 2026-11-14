import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideHeardVoice } from '../../core/audio/testing';
import { PUSH_PLATFORM, type PushPermission, type PushPlatform } from '../../core/push/push-notifications';
import { PushOffer } from './push-offer';

// Spec: backlog Y.1 — s'abonner aux notifications ; cahier des charges « Notifications push »
// (S'abonner) : l'accord d'abord, un refus ne change rien d'autre, Plus tard ne revient pas.

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const token = `e30.${btoa(JSON.stringify({ sub: uuid(51), tenant: uuid(10) })).replace(/=+$/, '')}.c2ln`;
const CLE = `B${'A'.repeat(86)}`;
const ABONNEMENT = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123', keys: { p256dh: `B${'q'.repeat(86)}`, auth: 'c2VjcmV0LWF1dGgtMTZieQ' } };
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

/** The phone's browser, as the test wants it: what it says of the permission, and what the person answers. */
function unTelephone(permission: PushPermission, answer: 'granted' | 'denied' | 'default' = 'granted') {
  let current = permission;
  const platform: PushPlatform & { subscribed: string[]; unsubscribed: number } = {
    subscribed: [],
    unsubscribed: 0,
    permission: () => current,
    requestPermission: async () => (current = answer),
    subscribe: async (key) => {
      platform.subscribed.push(key);
      return ABONNEMENT;
    },
    unsubscribe: async () => {
      platform.unsubscribed += 1;
    },
  };
  return platform;
}

describe('Le cahier propose les notifications', () => {
  let heard: string[][];

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('yaar.session', JSON.stringify({ token, expiresAt: '2099-01-01T00:00:00.000Z', role: 'collaborator', account: { name: 'Ousmane', avatar: 'baobab', language: 'fr' } }));
  });

  async function ouvre(platform: PushPlatform, key: 'cle' | 'absente' = 'cle') {
    TestBed.resetTestingModule();
    const voice = provideHeardVoice(['push-ask', 'push-on']);
    heard = voice.heard;
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), { provide: PUSH_PLATFORM, useValue: platform }, ...voice.providers] });
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(PushOffer);
    fixture.detectChanges();
    await settle();
    for (const request of http.match('/api/v1/push/public-key')) {
      if (key === 'cle') request.flush({ publicKey: CLE });
      else request.flush({ kind: 'PushNotConfigured' }, { status: 404, statusText: 'Not Found' });
    }
    await settle();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const tap = async (selector: string) => {
      (element.querySelector(selector) as HTMLButtonElement).click();
      await settle();
      fixture.detectChanges();
    };
    return { http, element, tap, fixture };
  }

  it('le chef peut prévenir sur ce téléphone : une carte le dit, avec la cloche et la voix ; Oui demande l’accord puis abonne le téléphone', async () => {
    const platform = unTelephone('default', 'granted');
    const { http, element, tap, fixture } = await ouvre(platform);

    expect(element.querySelector('.offer')?.textContent).toContain('Le chef peut te prévenir sur ce téléphone');
    expect(element.querySelector('.offer use')?.getAttribute('href')).toContain('bell');
    await tap('.offer app-speaker-button button');
    await vi.waitFor(() => expect(heard.flat()).toContain('fr/push-ask'));

    await tap('.offer .yes');
    const put = http.expectOne({ method: 'PUT', url: '/api/v1/push-subscription' });
    expect(put.request.body).toEqual(ABONNEMENT);
    expect(put.request.headers.get('Authorization')).toBe(`Bearer ${token}`);
    put.flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    fixture.detectChanges();

    expect(platform.subscribed).toEqual([CLE]);
    expect(element.querySelector('.offer')).toBeNull();
    await vi.waitFor(() => expect(heard.flat()).toContain('fr/push-on'));
  });

  it('le téléphone refuse : la carte part, rien n’est envoyé, et elle ne revient pas — l’application marche sans notification', async () => {
    const platform = unTelephone('default', 'denied');
    const { http, element, tap } = await ouvre(platform);

    await tap('.offer .yes');
    http.expectNone({ method: 'PUT', url: '/api/v1/push-subscription' });
    expect(element.querySelector('.offer')).toBeNull();

    const again = await ouvre(platform);
    expect(again.element.querySelector('.offer')).toBeNull();
  });

  it('« Plus tard » range la carte, et elle ne revient pas à la prochaine ouverture', async () => {
    const platform = unTelephone('default');
    const { element, tap, http } = await ouvre(platform);

    await tap('.offer .later');
    expect(element.querySelector('.offer')).toBeNull();
    http.expectNone({ method: 'PUT', url: '/api/v1/push-subscription' });

    const again = await ouvre(platform);
    expect(again.element.querySelector('.offer')).toBeNull();
  });

  it('déjà autorisé : le téléphone s’abonne sans rien demander, et aucune carte ne s’affiche', async () => {
    const platform = unTelephone('granted');
    const { http, element } = await ouvre(platform);

    http.expectOne({ method: 'PUT', url: '/api/v1/push-subscription' }).flush(null, { status: 204, statusText: 'No Content' });
    expect(platform.subscribed).toEqual([CLE]);
    expect(element.querySelector('.offer')).toBeNull();
  });

  it('sans notification possible — navigateur qui ne sait pas, ou serveur sans clé — rien n’est proposé', async () => {
    const sansNavigateur = await ouvre(unTelephone('unsupported'));
    expect(sansNavigateur.element.querySelector('.offer')).toBeNull();
    sansNavigateur.http.expectNone('/api/v1/push/public-key');

    const sansCle = await ouvre(unTelephone('default'), 'absente');
    expect(sansCle.element.querySelector('.offer')).toBeNull();
  });
});
