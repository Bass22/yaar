import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { IDBFactory } from 'fake-indexeddb';
import type { CaretakerChef, CaretakerContext } from '@contracts';
import { provideHeardVoice } from '../../../core/audio/testing';
import { CLOCK } from '../../../core/clock';
import { Outbox } from '../../../core/outbox/outbox';
import { OUTBOX } from '../../../core/sync/journal-sync';
import { NotebookPage } from '../../notebook/notebook-page';

// Spec: backlog M.5 — parler au chef par WhatsApp ; cahier des charges « Parler au chef passe par
// WhatsApp » (décision du 2026-11-08) ; maquette journal-gardien.html (« Prévenir le chef », Parler).

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT = uuid(10);
const NORD = uuid(3);
const OUSMANE = uuid(51);
const token = `e30.${btoa(JSON.stringify({ sub: OUSMANE, tenant: TENANT })).replace(/=+$/, '')}.c2ln`;
const NOW = new Date('2026-11-06T08:00:00.000Z');
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

const contexte = (chef: CaretakerChef | null): CaretakerContext => ({
  chef,
  sites: [{ siteId: NORD, name: 'Poulailler Nord', timeZone: 'Africa/Dakar', today: '2026-11-06', primaryCaretakerId: OUSMANE, campaigns: [] }],
});

describe('Parler au chef', () => {
  let heard: string[][];
  let opened: string[];

  const ouvre = async (context: CaretakerContext) => {
    const voice = provideHeardVoice(['talk-no-chef']);
    heard = voice.heard;
    const outbox = await Outbox.open(new IDBFactory());
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: OUTBOX, useValue: Promise.resolve(outbox) }, { provide: CLOCK, useValue: { now: () => NOW } }, ...voice.providers],
    });
    const fixture = TestBed.createComponent(NotebookPage);
    fixture.detectChanges();
    TestBed.inject(HttpTestingController).expectOne('/api/v1/caretaker/context').flush(context);
    const element = fixture.nativeElement as HTMLElement;
    const refresh = async () => {
      await settle();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    await refresh();
    const soon = (check: () => void) => vi.waitFor(async () => {
      await refresh();
      check();
    });
    return { element, soon };
  };

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('yaar.session', JSON.stringify({ token, expiresAt: '2099-01-01T00:00:00.000Z', role: 'collaborator', account: { name: 'Ousmane', avatar: 'baobab', language: 'wo' } }));
    opened = [];
    vi.spyOn(window, 'open').mockImplementation((url) => {
      opened.push(String(url));
      return null;
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('« Parler » ouvre WhatsApp sur le numéro du chef, sans texte pré-rempli : le gardien y laisse son vocal', async () => {
    const { element } = await ouvre(contexte({ name: 'Le gérant', phone: '+221770000003' }));

    element.querySelector<HTMLElement>('app-talk-to-chef app-gesture-button button')?.click();

    expect(opened).toEqual(['https://wa.me/221770000003']);
  });

  it('le geste est là même sans bande en cours : on prévient le chef de tout', async () => {
    const { element } = await ouvre(contexte({ name: 'Le gérant', phone: '+221770000003' }));

    expect(element.querySelector('app-talk-to-chef app-gesture-button')?.textContent).toContain('Parler');
  });

  it('sans chef à joindre, rien ne s’ouvre : un post-it et la voix le disent', async () => {
    const { element, soon } = await ouvre(contexte(null));

    element.querySelector<HTMLElement>('app-talk-to-chef app-gesture-button button')?.click();

    expect(opened).toEqual([]);
    await soon(() => expect(element.querySelector('app-talk-to-chef .no-chef')?.textContent).toContain('Le numéro du chef n’est pas encore dans le cahier'));
    await soon(() => expect(heard.at(-1)).toEqual(['wo/talk-no-chef']));
  });
});
