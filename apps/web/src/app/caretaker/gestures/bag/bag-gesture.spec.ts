import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { IDBFactory } from 'fake-indexeddb';
import type { CaretakerCampaign, CaretakerContext, CaretakerJournalLine } from '@contracts';
import { provideHeardVoice } from '../../../core/audio/testing';
import { CLOCK } from '../../../core/clock';
import { Outbox } from '../../../core/outbox/outbox';
import { OUTBOX } from '../../../core/sync/journal-sync';
import { NotebookPage } from '../../notebook/notebook-page';

// Spec: backlog K.2 — déclarer un sac ouvert, par le même parcours que les morts (K.1) ;
// cahier des charges « On déclare des changements d'état physiques » (un sac OUVERT, pas un repas),
// « Gestes du cahier » ; maquette journal-gardien.html (geste « Sac ouvert », compteur) ;
// backlog K.3 et CdC « Garde-fous anti-doublon » — le rappel des sacs déjà écrits, la somme seule.

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT = uuid(10);
const NORD = uuid(3);
const BANDE = uuid(4);
const OUSMANE = uuid(51);
const AWA = uuid(52);
const token = `e30.${btoa(JSON.stringify({ sub: OUSMANE, tenant: TENANT })).replace(/=+$/, '')}.c2ln`;
// Friday November 6th, 2026, 08:00 in Dakar.
const NOW = new Date('2026-11-06T08:00:00.000Z');
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

const uneBande = (fields: Partial<CaretakerCampaign> = {}): CaretakerCampaign => ({ campaignId: BANDE, placementDay: '2026-10-15', campaignDay: 22, liveCount: 938, journal: [], deliveries: [], weighingRequests: [], strain: 'Cobb500', ...fields });
const contexte = (bande: CaretakerCampaign = uneBande()): CaretakerContext => ({
  chef: null,
  sites: [{ siteId: NORD, name: 'Poulailler Nord', timeZone: 'Africa/Dakar', today: '2026-11-06', primaryCaretakerId: OUSMANE, campaigns: [bande] }],
});

const ecritParAwa = (rank: number, fact: CaretakerJournalLine['fact'], businessDate = '2026-11-06'): CaretakerJournalLine => ({
  id: uuid(rank), businessDate, recordedAt: `${businessDate}T07:00:00.000Z`, author: { id: AWA, name: 'Awa' }, fact, corrected: false, retracted: false,
});

describe('Déclarer un sac ouvert', () => {
  let outbox: Outbox;
  let heard: string[][];
  let taps: number;

  const ouvre = async (context: CaretakerContext = contexte()) => {
    const voice = provideHeardVoice(['bags-how-many', 'bags-today-1', 'bags-today-2', 'bags-yesterday-1', 'confirm', 'bags-already-written-3', 'bags-in-addition-1', 'cancelled', 'written-thanks', 'past-day-yesterday']);
    heard = voice.heard;
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: OUTBOX, useValue: Promise.resolve(outbox) }, { provide: CLOCK, useValue: { now: () => NOW } }, ...voice.providers],
    });
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(NotebookPage);
    fixture.detectChanges();
    http.expectOne('/api/v1/caretaker/context').flush(context);
    const element = fixture.nativeElement as HTMLElement;
    const refresh = async () => {
      await settle();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    /** A tap of the caretaker, counted. */
    const tape = async (selector: string, text?: string) => {
      const target = Array.from(element.querySelectorAll<HTMLElement>(selector)).find((candidate) => text === undefined || candidate.textContent?.includes(text));
      if (target === undefined) {
        throw new Error(`Nothing to tap: ${selector} ${text ?? ''}`);
      }
      taps++;
      target.click();
      await refresh();
    };
    await refresh();
    const soon = (check: () => void | Promise<void>) => vi.waitFor(async () => {
      await refresh();
      await check();
    });
    return { element, tape, soon };
  };
  const ouverte = (element: HTMLElement) => element.querySelector('app-declaration-gesture.bag app-sheet section.on');
  const ecrits = async () => (await outbox.entriesOf(BANDE)).map((entry) => entry.payload);

  beforeEach(async () => {
    localStorage.clear();
    localStorage.setItem('yaar.session', JSON.stringify({ token, expiresAt: '2099-01-01T00:00:00.000Z', role: 'collaborator', account: { name: 'Ousmane', avatar: 'baobab', language: 'wo' } }));
    outbox = await Outbox.open(new IDBFactory());
    taps = 0;
  });

  it("trois taps — Sac ouvert, C'est tout, Oui — écrivent un sac ouvert pour le jour, la bande et le site, dans l'outbox", async () => {
    const { tape, soon } = await ouvre();

    await tape('app-declaration-gesture.bag app-gesture-button button');
    await tape('app-sheet section.on .yes');
    await tape('app-sheet section.on .yes');

    expect(taps).toBe(3);
    await soon(async () => expect(await ecrits()).toHaveLength(1));
    expect(await ecrits()).toEqual([
      { id: expect.any(String), siteId: NORD, campaignId: BANDE, businessDate: '2026-11-06', recordedAt: '2026-11-06T08:00:00.000Z', fact: { type: 'BagOpened', quantity: 1 } },
    ]);
  });

  it('chaque « + » ajoute un sac ouvert dessiné à la pile, et « − » en retire un', async () => {
    const { element, tape } = await ouvre();
    await tape('app-declaration-gesture.bag app-gesture-button button');
    await tape('app-sheet section.on .plus');
    await tape('app-sheet section.on .plus');
    await tape('app-sheet section.on .minus');

    expect(ouverte(element)?.querySelector('.title')?.textContent).toContain('Combien de sacs ouverts ?');
    expect(ouverte(element)?.querySelectorAll('app-pile app-pictogram.open-bag')).toHaveLength(2);
    expect(ouverte(element)?.querySelector('app-pile .pile')?.getAttribute('aria-label')).toBe('2 sacs ouverts');
  });

  it("la voix demande combien, puis relit : « 2 sacs ouverts aujourd'hui. C'est bien ça ? »", async () => {
    const { element, tape, soon } = await ouvre();
    await tape('app-declaration-gesture.bag app-gesture-button button');
    await tape('app-sheet section.on .plus');
    await tape('app-sheet section.on .yes');

    await soon(() => expect(heard).toEqual([['wo/bags-how-many'], ['wo/bags-today-2', 'wo/confirm']]));
    expect(ouverte(element)?.querySelector('.phrase')?.textContent).toContain("2 sacs ouverts aujourd'hui ?");
  });

  it("pour hier, la voix dit « hier » et l'événement porte la date d'hier", async () => {
    const { tape, soon } = await ouvre();
    await tape('.days .day', 'Hier');
    await tape('app-declaration-gesture.bag app-gesture-button button');
    await tape('app-sheet section.on .yes');
    await tape('app-sheet section.on .yes');

    await soon(async () => expect(await ecrits()).toHaveLength(1));
    await soon(() => expect(heard).toContainEqual(['wo/bags-yesterday-1', 'wo/confirm']));
    expect((await ecrits())[0]?.businessDate).toBe('2026-11-05');
  });

  it("Non ferme la feuille sans rien écrire : « D'accord, on n'écrit rien »", async () => {
    const { element, tape, soon } = await ouvre();
    await tape('app-declaration-gesture.bag app-gesture-button button');
    await tape('app-sheet section.on .yes');
    await tape('app-sheet section.on .no');

    expect(ouverte(element)).toBeNull();
    expect(await ecrits()).toEqual([]);
    await soon(() => expect(heard.at(-1)).toEqual(['wo/cancelled']));
  });

  it('après le Oui : le tampon, la ligne « 2 sacs ouverts » au journal du jour, et les vivants inchangés', async () => {
    const { element, tape, soon } = await ouvre();
    await tape('app-declaration-gesture.bag app-gesture-button button');
    await tape('app-sheet section.on .plus');
    await tape('app-sheet section.on .yes');
    await tape('app-sheet section.on .yes');

    await soon(() => expect(element.querySelector('app-declaration-gesture.bag app-stamp .stamp')?.textContent).toContain('C’est noté'));
    await soon(() => expect(element.querySelector('.lines .line .words b')?.textContent).toBe('2 sacs ouverts'));
    await soon(() => expect(heard.at(-1)).toEqual(['wo/written-thanks']));
    expect(element.querySelector('.strip .alive')?.textContent).toContain('938');
  });

  it('des sacs déjà écrits ce jour-là, par lui et par un autre : la voix en dit la somme seule, puis demande si le sien est en plus — Oui l’écrit', async () => {
    await outbox.record(OUSMANE, { siteId: NORD, campaignId: BANDE, businessDate: '2026-11-06', recordedAt: '2026-11-06T07:30:00.000Z', fact: { type: 'BagOpened', quantity: 2 } });
    const journal = [ecritParAwa(1, { type: 'BagOpened', quantity: 1 }), ecritParAwa(2, { type: 'BagOpened', quantity: 7 }, '2026-11-05'), ecritParAwa(3, { type: 'Death', quantity: 4 })];
    const { element, tape, soon } = await ouvre(contexte(uneBande({ journal })));
    await soon(() => expect(element.querySelectorAll('.lines .line')).toHaveLength(3));
    await tape('app-declaration-gesture.bag app-gesture-button button');
    await tape('app-sheet section.on .yes');

    await soon(() => expect(heard.at(-1)).toEqual(['wo/bags-today-1', 'wo/bags-already-written-3', 'wo/bags-in-addition-1']));
    expect(ouverte(element)?.querySelector('.already')?.textContent).toContain('Il y a déjà 3 sacs ouverts écrits pour ce jour. Ton sac, c’est en plus ?');
    await tape('app-sheet section.on .yes');
    await soon(async () => expect(await ecrits()).toHaveLength(2));
  });

  it('des morts écrits ce jour-là ne déclenchent pas le rappel des sacs : la confirmation reste simple', async () => {
    const { tape, soon } = await ouvre(contexte(uneBande({ journal: [ecritParAwa(3, { type: 'Death', quantity: 4 })] })));
    await tape('app-declaration-gesture.bag app-gesture-button button');
    await tape('app-sheet section.on .yes');

    await soon(() => expect(heard.at(-1)).toEqual(['wo/bags-today-1', 'wo/confirm']));
  });
});
