import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideHeardVoice } from '../audio/testing';
import { SignInPage } from './sign-in';

// Spec: backlog G.2 — se connecter sur le téléphone ; maquette journal-gardien-entree.html ;
// décisions du 2026-11-07 (comptes du téléphone en grands avatars, code ouvert au dernier
// chiffre, premier code tapé deux fois).

const OUSMANE = '00000000-0000-4000-8000-000000000051';
const tokenFor = (sub: string) => `e30.${btoa(JSON.stringify({ sub })).replace(/=+$/, '')}.c2ln`;
const session = (role = 'collaborator') => ({ token: tokenFor(OUSMANE), expiresAt: '2099-01-01T00:00:00.000Z', role, account: { name: 'Ousmane', avatar: 'baobab', language: 'wo' } });
const known = (role = 'collaborator') => [{ userId: OUSMANE, phone: '+221771234567', role, name: 'Ousmane', avatar: 'baobab', language: 'wo' }];
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Entrée du cahier', () => {
  let http: HttpTestingController;
  let heard: string[][];

  const open = async () => {
    const voice = provideHeardVoice(['avatar-baobab', 'sign-in-type-code', 'sign-in-wrong-pin', 'sign-in-wait', 'sign-in-choose-pin', 'sign-in-type-new-code', 'sign-in-type-new-code-again', 'sign-in-codes-differ']);
    heard = voice.heard;
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([{ path: '**', children: [] }]), ...voice.providers] });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(SignInPage);
    fixture.detectChanges();
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const refresh = async () => {
      await settle();
      fixture.detectChanges();
      await fixture.whenStable();
    };
    const click = async (selector: string) => {
      (element.querySelector(selector) as HTMLElement).click();
      await refresh();
    };
    const type = async (digits: string) => {
      for (const digit of digits) {
        const key = Array.from(element.querySelectorAll<HTMLButtonElement>('app-keypad .key')).find((button) => button.textContent?.trim() === digit);
        key?.click();
        await refresh();
      }
    };
    return { fixture, element, click, type, refresh };
  };

  beforeEach(() => localStorage.clear());
  afterEach(() => http.verify());

  it("les comptes déjà connectés sur ce téléphone s'affichent en grands avatars, avec leur nom : un tap pour choisir le sien", async () => {
    localStorage.setItem('yaar.accounts', JSON.stringify(known()));
    const { element } = await open();

    expect(element.querySelector('h1')?.textContent).toContain('Qui tient le cahier ?');
    const account = element.querySelector('.account');
    expect(account?.textContent).toContain('Ousmane');
    expect(account?.querySelector('app-avatar-badge [role="img"]')?.getAttribute('aria-label')).toBe('Le baobab');
  });

  it("le code d'un gardien a quatre ronds, et s'envoie au quatrième chiffre — sans bouton à chercher ; ouvert, le cahier s'affiche", async () => {
    localStorage.setItem('yaar.accounts', JSON.stringify(known()));
    const { element, click, type } = await open();
    await click('.account');

    expect(element.querySelectorAll('.rounds i')).toHaveLength(4);
    expect(element.querySelector('app-keypad .validate')).toBeNull();
    await type('7351');

    const request = http.expectOne('/api/v1/auth/sign-in');
    expect(request.request.body).toMatchObject({ phone: '+221771234567', pin: '7351' });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl');
    request.flush(session());
    await settle();
    expect(navigate).toHaveBeenCalledWith('/caretaker');
  });

  it("le code d'un admin a six ronds", async () => {
    localStorage.setItem('yaar.accounts', JSON.stringify(known('admin')));
    const { element, click } = await open();
    await click('.account');

    expect(element.querySelectorAll('.rounds i')).toHaveLength(6);
  });

  it("un code faux se voit : les ronds passent au rouge, un post-it le dit, et le code s'efface pour réessayer", async () => {
    localStorage.setItem('yaar.accounts', JSON.stringify(known()));
    const { element, click, type, refresh } = await open();
    await click('.account');
    await type('1111');

    http.expectOne('/api/v1/auth/sign-in').flush({ kind: 'InvalidCredentials' }, { status: 401, statusText: 'Unauthorized' });
    await refresh();

    expect(element.querySelector('.rounds')?.classList).toContain('refused');
    expect(element.querySelector('[role="alert"]')?.textContent).toContain("Ce n'est pas le bon code");
    expect(element.querySelectorAll('.rounds i.full')).toHaveLength(0);
    expect(heard.at(-1)).toEqual(['wo/sign-in-wrong-pin']);
  });

  // Spec: backlog I.2 — la voix de l'entrée, dans la langue du compte touché
  it("toucher son dessin le fait dire, puis la voix demande le code — dans la langue de ce compte", async () => {
    localStorage.setItem('yaar.accounts', JSON.stringify(known()));
    const { click, refresh } = await open();
    await click('.account');
    await refresh();

    expect(heard).toEqual([['wo/avatar-baobab', 'wo/sign-in-type-code']]);
  });

  it("trop d'essais : le post-it dit l'heure à laquelle réessayer", async () => {
    localStorage.setItem('yaar.accounts', JSON.stringify(known()));
    const { element, click, type, refresh } = await open();
    await click('.account');
    await type('1111');

    http.expectOne('/api/v1/auth/sign-in').flush({ kind: 'TooManyAttempts', retryAt: '2026-11-07T08:00:30.000Z' }, { status: 429, statusText: 'Too Many' });
    await refresh();

    expect(element.querySelector('[role="alert"]')?.textContent).toContain("Trop d'essais. Réessaie à");
  });

  it("un premier compte sur ce téléphone passe par son numéro ; son code se valide d'un bouton, son rôle n'étant pas encore connu", async () => {
    const { element, click, type } = await open();

    expect(element.querySelector('input[type="tel"]')).not.toBeNull();
    const input = element.querySelector('input[type="tel"]') as HTMLInputElement;
    input.value = '+221770000052';
    input.dispatchEvent(new Event('input'));
    await click('.go');
    await type('7351');
    await click('app-keypad .validate');

    expect(http.expectOne('/api/v1/auth/sign-in').request.body).toMatchObject({ phone: '+221770000052', pin: '7351' });
  });

  it("au premier code, on tape celui du chef, puis le sien deux fois : s'ils diffèrent, on recommence ; pareils, ils partent avec celui du chef", async () => {
    localStorage.setItem('yaar.accounts', JSON.stringify(known()));
    const { element, click, type, refresh } = await open();
    await click('.account');
    await type('6402');
    http.expectOne('/api/v1/auth/sign-in').flush({ kind: 'PinMustBeChosen' }, { status: 403, statusText: 'Forbidden' });
    await refresh();
    expect(element.querySelector('.steps .current')?.textContent).toContain('Ton code');

    await type('7351');
    expect(element.querySelector('.steps .current')?.textContent).toContain('Encore');
    await type('7352');
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('Les deux codes ne sont pas pareils');
    expect(heard.slice(1)).toEqual([['wo/sign-in-choose-pin'], ['wo/sign-in-type-new-code-again'], ['wo/sign-in-codes-differ']]);
    expect(element.querySelector('.steps .current')?.textContent).toContain('Ton code');

    await type('7351');
    await type('7351');
    const request = http.expectOne('/api/v1/auth/choose-pin');
    expect(request.request.body).toMatchObject({ phone: '+221771234567', provisionalPin: '6402', newPin: '7351' });
    request.flush(session());
  });

  it("on revient au choix du compte d'un tap, et l'étape du numéro se nomme : « Ton numéro »", async () => {
    localStorage.setItem('yaar.accounts', JSON.stringify(known()));
    const { element, click } = await open();
    await click('.account');
    await click('.back');
    expect(element.querySelector('h1')?.textContent).toContain('Qui tient le cahier ?');

    await click('.other');
    expect(element.querySelector('h1')?.textContent).toContain('Ton numéro');
  });

  it("l'effacement retire le dernier chiffre tapé", async () => {
    localStorage.setItem('yaar.accounts', JSON.stringify(known()));
    const { element, click, type } = await open();
    await click('.account');
    await type('73');
    await click('app-keypad .erase');

    expect(element.querySelectorAll('.rounds i.full')).toHaveLength(1);
  });
});
