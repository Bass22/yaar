import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from './auth';
import { SessionStore } from './session-store';

// Spec: backlog G.2 — se connecter sur le téléphone ; E.2 (connexion), E.5 (premier PIN) ;
// CdC « Identité ».

const tokenFor = (sub: string) => `e30.${btoa(JSON.stringify({ sub })).replace(/=+$/, '')}.c2ln`;
const OUSMANE = '00000000-0000-4000-8000-000000000051';

describe('Connexion depuis le téléphone', () => {
  let auth: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it("se connecte avec le numéro, le PIN et l'appareil, garde la session, et dit où aller : le cahier pour un gardien", async () => {
    const signing = auth.signIn('+221771234567', '7351');

    const request = http.expectOne('/api/v1/auth/sign-in');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ phone: '+221771234567', pin: '7351', deviceId: TestBed.inject(SessionStore).deviceId() });
    request.flush({ token: tokenFor(OUSMANE), expiresAt: '2099-01-01T00:00:00.000Z', role: 'collaborator', account: { name: 'Ousmane', avatar: 'baobab', language: 'wo' } });

    expect(await signing).toEqual({ ok: true, home: '/caretaker' });
    expect(auth.session()).toMatchObject({ status: 'active', userId: OUSMANE, role: 'collaborator', account: { name: 'Ousmane', avatar: 'baobab', language: 'wo' } });
    expect(auth.knownAccounts()).toEqual([{ userId: OUSMANE, phone: '+221771234567', role: 'collaborator', name: 'Ousmane', avatar: 'baobab' }]);
  });

  it("un admin arrive sur le bureau", async () => {
    const signing = auth.signIn('+221771234500', '482913');
    http.expectOne('/api/v1/auth/sign-in').flush({ token: tokenFor(OUSMANE), expiresAt: '2099-01-01T00:00:00.000Z', role: 'admin', account: { name: 'Ousmane', avatar: 'baobab', language: 'wo' } });

    expect(await signing).toEqual({ ok: true, home: '/admin' });
  });

  it("un refus du serveur est rendu avec son motif, et rien n'est gardé", async () => {
    const cases: [number, object, unknown][] = [
      [401, { kind: 'InvalidCredentials' }, { kind: 'InvalidCredentials' }],
      [429, { kind: 'TooManyAttempts', retryAt: '2026-11-07T08:00:30.000Z' }, { kind: 'TooManyAttempts', retryAt: '2026-11-07T08:00:30.000Z' }],
      [403, { kind: 'AccountBlocked' }, { kind: 'AccountBlocked' }],
      [403, { kind: 'PinMustBeChosen' }, { kind: 'PinMustBeChosen' }],
      [403, { kind: 'ProvisionalPinExpired' }, { kind: 'ProvisionalPinExpired' }],
    ];
    for (const [status, body, refusal] of cases) {
      const signing = auth.signIn('+221771234567', '0000');
      http.expectOne('/api/v1/auth/sign-in').flush(body, { status, statusText: 'Refused' });
      expect(await signing).toEqual({ ok: false, refusal });
    }
    expect(auth.session()).toEqual({ status: 'none' });
  });

  it("sans réseau, ou le serveur en panne, la connexion le dit : ce n'est pas un mauvais PIN", async () => {
    const offline = auth.signIn('+221771234567', '7351');
    http.expectOne('/api/v1/auth/sign-in').error(new ProgressEvent('error'));
    expect(await offline).toEqual({ ok: false, refusal: { kind: 'Offline' } });

    const down = auth.signIn('+221771234567', '7351');
    http.expectOne('/api/v1/auth/sign-in').flush('Bad Gateway', { status: 502, statusText: 'Bad Gateway' });
    expect(await down).toEqual({ ok: false, refusal: { kind: 'ServerUnavailable' } });

    const malformed = auth.signIn('77', '7351');
    http.expectOne('/api/v1/auth/sign-in').flush({ statusCode: 400, message: 'Bad Request' }, { status: 400, statusText: 'Bad Request' });
    expect(await malformed).toEqual({ ok: false, refusal: { kind: 'InvalidRequest' } });
  });

  it("à la première connexion, le PIN provisoire et le nouveau partent ensemble, et la session s'ouvre", async () => {
    const choosing = auth.choosePin('+221771234567', '640219', '7351');

    const request = http.expectOne('/api/v1/auth/choose-pin');
    expect(request.request.body).toEqual({ phone: '+221771234567', provisionalPin: '640219', newPin: '7351', deviceId: TestBed.inject(SessionStore).deviceId() });
    request.flush({ token: tokenFor(OUSMANE), expiresAt: '2099-01-01T00:00:00.000Z', role: 'collaborator', account: { name: 'Ousmane', avatar: 'baobab', language: 'wo' } });

    expect(await choosing).toEqual({ ok: true, home: '/caretaker' });
  });

  it("se déconnecter oublie la session", async () => {
    const signing = auth.signIn('+221771234567', '7351');
    http.expectOne('/api/v1/auth/sign-in').flush({ token: tokenFor(OUSMANE), expiresAt: '2099-01-01T00:00:00.000Z', role: 'collaborator', account: { name: 'Ousmane', avatar: 'baobab', language: 'wo' } });
    await signing;

    auth.signOut();

    expect(auth.session()).toEqual({ status: 'none' });
  });
});
