import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideHeardVoice } from '../audio/testing';
import { NotificationLanding } from './notification-landing';

// Spec: backlog Y.4 — un tap sur une notification ouvre l'application sur la carte concernée et
// lit le message ; l'adresse vient d'une liste fermée ; une cible inconnue ouvre l'accueil.
// Le service worker ouvre `/notification?kind=…&campaign=…`, même l'application fermée.

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const BANDE = uuid(4);
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
const token = `e30.${btoa(JSON.stringify({ sub: uuid(51), tenant: uuid(10) })).replace(/=+$/, '')}.c2ln`;
const session = (role: 'collaborator' | 'admin') => JSON.stringify({ token, expiresAt: '2099-01-01T00:00:00.000Z', role, account: { name: 'Ousmane', avatar: 'baobab', language: 'fr' } });

describe('Un tap sur une notification', () => {
  let heard: string[][];

  async function tape(url: string, role: 'collaborator' | 'admin' | null = 'collaborator') {
    localStorage.clear();
    if (role !== null) localStorage.setItem('yaar.session', session(role));
    TestBed.resetTestingModule();
    const voice = provideHeardVoice(['delivery-announced', 'weighing-requested', 'nothing-lost-reminder']);
    heard = voice.heard;
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'notification', component: NotificationLanding },
          { path: 'caretaker', children: [] },
          { path: 'admin', children: [{ path: 'accueil', children: [] }] },
          { path: 'sign-in', children: [] },
        ]),
        ...voice.providers,
      ],
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    await settle();
    return TestBed.inject(Router).url;
  }

  it('une livraison annoncée ouvre le cahier sur la bande, et la voix dit la carte', async () => {
    expect(await tape(`/notification?kind=DeliveryAnnounced&campaign=${BANDE}`)).toBe(`/caretaker?campaign=${BANDE}`);
    await vi.waitFor(() => expect(heard.flat()).toEqual(['fr/delivery-announced']));
  });

  it('une pesée demandée et le rappel du matin : le cahier, chacun sa phrase — le rappel, celle du post-it « Rien perdu hier »', async () => {
    expect(await tape(`/notification?kind=WeighingRequested&campaign=${BANDE}`)).toBe(`/caretaker?campaign=${BANDE}`);
    await vi.waitFor(() => expect(heard.flat()).toEqual(['fr/weighing-requested']));

    expect(await tape(`/notification?kind=MorningReminder&campaign=${BANDE}`)).toBe(`/caretaker?campaign=${BANDE}`);
    await vi.waitFor(() => expect(heard.flat()).toEqual(['fr/nothing-lost-reminder']));
  });

  it('une correction et des morts de trop ouvrent « À traiter » au bureau', async () => {
    expect(await tape(`/notification?kind=CorrectionWritten&campaign=${BANDE}`, 'admin')).toBe('/admin/accueil');
    expect(await tape(`/notification?kind=TooManyDeaths&campaign=${BANDE}`, 'admin')).toBe('/admin/accueil');
  });

  it('une sorte inconnue, une bande mal nommée ou une vue que le rôle n’a pas : l’accueil de chacun, sans rien dire', async () => {
    expect(await tape('/notification?kind=Ailleurs&campaign=https://evil.example')).toBe('/caretaker');
    // Ce que tout objet JavaScript porte n'est pas une sorte de la liste
    expect(await tape(`/notification?kind=constructor&campaign=${BANDE}`, 'admin')).toBe('/admin');
    expect(await tape(`/notification?kind=toString&campaign=${BANDE}`)).toBe('/caretaker');
    expect(await tape(`/notification?kind=DeliveryAnnounced&campaign=../admin`)).toBe('/caretaker');
    // Un gardien qui toucherait une notification du bureau reste dans son cahier
    expect(await tape(`/notification?kind=CorrectionWritten&campaign=${BANDE}`)).toBe('/caretaker');
    expect(await tape(`/notification?kind=DeliveryAnnounced&campaign=${BANDE}`, 'admin')).toBe('/admin');
    expect(heard.flat()).toEqual([]);
  });

  it('sans session, l’écran du numéro', async () => {
    expect(await tape(`/notification?kind=DeliveryAnnounced&campaign=${BANDE}`, null)).toBe('/sign-in');
  });
});
