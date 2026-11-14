import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { sessionRefused } from './session-refused';

// Spec: correctif du 2026-11-13 (vu par le fondateur en local, une base refaite à neuf) — une session
// que le serveur refuse (compte bloqué, jetons invalidés, secret changé) ne se lit pas « Pas de réseau » :
// elle se ferme, et l'écran du numéro revient. Le numéro du compte et la file d'attente restent.

@Component({ template: '' })
class Blank {}

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const token = `e30.${btoa(JSON.stringify({ sub: uuid(54), tenant: uuid(10) })).replace(/=+$/, '')}.c2ln`;
const session = JSON.stringify({ token, expiresAt: '2099-01-01T00:00:00.000Z', role: 'admin', account: { name: 'Le gérant', avatar: 'baobab', language: 'fr' } });
const account = JSON.stringify({ userId: uuid(54), phone: '+221770000002', role: 'admin', name: 'Le gérant', avatar: 'baobab', language: 'fr' });

describe('Une session refusée par le serveur', () => {
  let http: HttpTestingController;
  let client: HttpClient;
  let router: Router;

  beforeEach(async () => {
    localStorage.clear();
    localStorage.setItem('yaar.session', session);
    localStorage.setItem('yaar.account', account);
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([sessionRefused])), provideHttpClientTesting(), provideRouter([{ path: 'sign-in', component: Blank }, { path: 'admin', component: Blank }])],
    });
    http = TestBed.inject(HttpTestingController);
    client = TestBed.inject(HttpClient);
    router = TestBed.inject(Router);
    await router.navigateByUrl('/admin');
  });

  const lis = async (url: string, status: number) => {
    const reading = firstValueFrom(client.get(url)).catch(() => 'refusé');
    http.expectOne(url).flush({}, { status, statusText: 'Refused' });
    await reading;
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  it('un refus de session (401) ferme la session et ramène à l’écran du numéro ; le numéro du compte reste', async () => {
    await lis('/api/v1/caretaker/context', 401);

    expect(localStorage.getItem('yaar.session')).toBeNull();
    expect(localStorage.getItem('yaar.account')).toBe(account);
    expect(router.url).toBe('/sign-in');
  });

  it('un refus de la connexion elle-même (un mauvais code) reste à l’écran qui l’a demandée', async () => {
    const tentative = firstValueFrom(client.post('/api/v1/auth/sign-in', {})).catch(() => 'refusé');
    http.expectOne('/api/v1/auth/sign-in').flush({ kind: 'InvalidCredentials' }, { status: 401, statusText: 'Unauthorized' });
    await tentative;

    expect(localStorage.getItem('yaar.session')).toBe(session);
    expect(router.url).toBe('/admin');
  });

  it('un autre refus (403), une panne (500) ou pas de réseau ne ferment rien', async () => {
    await lis('/api/v1/orders', 403);
    await lis('/api/v1/orders', 500);
    const sansReseau = firstValueFrom(client.get('/api/v1/orders')).catch(() => 'refusé');
    http.expectOne('/api/v1/orders').error(new ProgressEvent('error'));
    await sansReseau;

    expect(localStorage.getItem('yaar.session')).toBe(session);
    expect(router.url).toBe('/admin');
  });
});
