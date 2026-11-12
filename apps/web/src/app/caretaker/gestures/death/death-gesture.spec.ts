import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { IDBFactory } from 'fake-indexeddb';
import type { CaretakerCampaign, CaretakerContext, CaretakerJournalLine } from '@contracts';
import { provideHeardVoice } from '../../../core/audio/testing';
import { CLOCK } from '../../../core/clock';
import { Outbox, OutboxUnavailable } from '../../../core/outbox/outbox';
import { OUTBOX } from '../../../core/sync/journal-sync';
import { NotebookPage } from '../../notebook/notebook-page';

// Spec: backlog K.1 — déclarer des morts en trois taps ; cahier des charges « Gestes du cahier »,
// « Garde-fous anti-doublon » (la somme seule, Non n'écrit rien : décision du 2026-11-08),
// « La confiance est visible » ; maquette journal-gardien.html (compteur, confirmation, tampon).

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
const mortsDAwa = (quantity: number, businessDate = '2026-11-06'): CaretakerJournalLine => ({
  id: uuid(1), businessDate, recordedAt: `${businessDate}T07:00:00.000Z`, author: { id: AWA, name: 'Awa' }, fact: { type: 'Death', quantity }, corrected: false, retracted: false,
});

describe('Déclarer des morts', () => {
  let outbox: Outbox;
  let heard: string[][];
  let taps: number;

  const ouvre = async (context: CaretakerContext = contexte(), outboxProvider: { useValue: Promise<Outbox> } | { useFactory: () => Promise<Outbox> } = { useValue: Promise.resolve(outbox) }) => {
    const voice = provideHeardVoice(['deaths-how-many', 'deaths-today-1', 'deaths-today-2', 'deaths-today-3', 'deaths-yesterday-1', 'confirm', 'already-written-5', 'deaths-in-addition-1', 'deaths-show', 'cancelled', 'written-thanks', 'storage-full', 'past-day-yesterday']);
    heard = voice.heard;
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: OUTBOX, ...outboxProvider }, { provide: CLOCK, useValue: { now: () => NOW } }, ...voice.providers],
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
    /** Waits for what the outbox holds to reach the screen: its reads and writes take their time on a loaded machine. */
    const soon = (check: () => void | Promise<void>) => vi.waitFor(async () => {
      await refresh();
      await check();
    });
    return { element, tape, refresh, soon };
  };
  const ouverte = (element: HTMLElement) => element.querySelector('app-declaration-gesture.death app-sheet section.on');
  const ecrits = async () => (await outbox.entriesOf(BANDE)).map((entry) => entry.payload);

  beforeEach(async () => {
    localStorage.clear();
    localStorage.setItem('yaar.session', JSON.stringify({ token, expiresAt: '2099-01-01T00:00:00.000Z', role: 'collaborator', account: { name: 'Ousmane', avatar: 'baobab', language: 'wo' } }));
    outbox = await Outbox.open(new IDBFactory());
    taps = 0;
  });

  it("trois taps — Mort, C'est tout, Oui — écrivent un mort pour le jour, la bande et le site, à l'heure du téléphone, dans l'outbox", async () => {
    const { tape, soon } = await ouvre();

    await tape('app-declaration-gesture.death app-gesture-button button');
    await tape('app-sheet section.on .yes');
    await tape('app-sheet section.on .yes');

    expect(taps).toBe(3);
    await soon(async () => expect(await ecrits()).toHaveLength(1));
    expect(await ecrits()).toEqual([
      { id: expect.any(String), siteId: NORD, campaignId: BANDE, businessDate: '2026-11-06', recordedAt: '2026-11-06T08:00:00.000Z', fact: { type: 'Death', quantity: 1, deathEvidence: { kind: 'NoPhoto' } } },
    ]);
  });

  it('chaque « + » ajoute un poulet couché à la pile, et « − » en retire un', async () => {
    const { element, tape } = await ouvre();
    await tape('app-declaration-gesture.death app-gesture-button button');
    await tape('app-sheet section.on .plus');
    await tape('app-sheet section.on .plus');
    await tape('app-sheet section.on .minus');

    expect(ouverte(element)?.querySelectorAll('app-pile app-pictogram')).toHaveLength(2);
    expect(ouverte(element)?.querySelector('.number')?.textContent).toBe('2');
  });

  it("la voix demande combien, puis relit la déclaration avant le Oui : « 2 poulets morts aujourd'hui. C'est bien ça ? »", async () => {
    const { element, tape, soon } = await ouvre();
    await tape('app-declaration-gesture.death app-gesture-button button');
    await tape('app-sheet section.on .plus');
    await tape('app-sheet section.on .yes');

    await soon(() => expect(heard).toEqual([['wo/deaths-how-many'], ['wo/deaths-today-2', 'wo/confirm', 'wo/deaths-show']]));
    expect(ouverte(element)?.querySelector('.phrase')?.textContent).toContain("2 poulets morts aujourd'hui ?");
    expect(ouverte(element)?.querySelector('.title')?.textContent).toBe("C'est bien ça ?");
  });

  it("le jour choisi est celui de la déclaration : pour hier, la voix dit « hier » et l'événement porte la date d'hier", async () => {
    const { tape, soon } = await ouvre();
    await tape('.days .day', 'Hier');
    await tape('app-declaration-gesture.death app-gesture-button button');
    await tape('app-sheet section.on .yes');
    await tape('app-sheet section.on .yes');

    await soon(async () => expect(await ecrits()).toHaveLength(1));
    await soon(() => expect(heard).toContainEqual(['wo/deaths-yesterday-1', 'wo/confirm', 'wo/deaths-show']));
    expect((await ecrits())[0]?.businessDate).toBe('2026-11-05');
  });

  it('des morts déjà écrits ce jour-là, par lui et par un autre : la voix dit la somme seule, puis demande si les siens sont en plus', async () => {
    await outbox.record(OUSMANE, { siteId: NORD, campaignId: BANDE, businessDate: '2026-11-06', recordedAt: '2026-11-06T07:30:00.000Z', fact: { type: 'Death', quantity: 2 } });
    const { element, tape, soon } = await ouvre(contexte(uneBande({ journal: [mortsDAwa(3), mortsDAwa(9, '2026-11-05')] })));
    await soon(() => expect(element.querySelector('.days .day:nth-child(3) .deaths')?.textContent).toContain('5'));
    await tape('app-declaration-gesture.death app-gesture-button button');
    await tape('app-sheet section.on .yes');

    await soon(() => expect(heard.at(-1)).toEqual(['wo/deaths-today-1', 'wo/already-written-5', 'wo/deaths-in-addition-1', 'wo/deaths-show']));
    expect(ouverte(element)?.querySelector('.already')?.textContent).toContain('Il y a déjà 5 morts écrits pour ce jour. Ton mort, c’est en plus ?');
    // The title asks what the voice asks: « c'est en plus ? », not « c'est bien ça ? ».
    expect(ouverte(element)?.querySelector('.title')?.textContent).toBe('C’est en plus ?');
  });

  it("Non ferme la feuille sans rien écrire, et la voix le dit : « D'accord, on n'écrit rien »", async () => {
    const { element, tape, soon } = await ouvre();
    await tape('app-declaration-gesture.death app-gesture-button button');
    await tape('app-sheet section.on .yes');
    await tape('app-sheet section.on .no');

    expect(ouverte(element)).toBeNull();
    expect(await ecrits()).toEqual([]);
    await soon(() => expect(heard.at(-1)).toEqual(['wo/cancelled']));
  });

  it('la croix du compteur ferme aussi sans rien écrire', async () => {
    const { element, tape } = await ouvre();
    await tape('app-declaration-gesture.death app-gesture-button button');
    await tape('app-sheet section.on .no');

    expect(ouverte(element)).toBeNull();
    expect(await ecrits()).toEqual([]);
  });

  it('après le Oui : le tampon « C’est noté », la ligne au journal du jour en attente d’envoi, et les vivants diminués', async () => {
    const { element, tape, soon } = await ouvre();
    await tape('app-declaration-gesture.death app-gesture-button button');
    await tape('app-sheet section.on .plus');
    await tape('app-sheet section.on .plus');
    await tape('app-sheet section.on .yes');
    await tape('app-sheet section.on .yes');

    await soon(() => expect(element.querySelector('app-declaration-gesture.death app-stamp .stamp')?.textContent).toContain('C’est noté'));
    await soon(() => expect(element.querySelector('.strip .alive')?.textContent).toContain('935'));
    await soon(() => expect(heard.at(-1)).toEqual(['wo/written-thanks']));
    const ligne = element.querySelector('.lines .line');
    expect([ligne?.querySelector('.words b')?.textContent, ligne?.querySelector('.words small')?.textContent]).toEqual(['3 morts', "Ousmane · en attente d'envoi"]);
    expect(element.querySelector('.strip .alive')?.textContent).toContain('935');
  });

  it("un double tap sur Oui n'écrit qu'une fois", async () => {
    const { element, tape, soon } = await ouvre();
    await tape('app-declaration-gesture.death app-gesture-button button');
    await tape('app-sheet section.on .yes');
    const oui = element.querySelector<HTMLElement>('app-sheet section.on .yes');
    oui?.click();
    oui?.click();
    await soon(() => expect(element.querySelector('app-declaration-gesture.death app-stamp .stamp')).not.toBeNull());

    expect(await ecrits()).toHaveLength(1);
  });

  it("un second tap sur Oui pendant que la feuille se ferme, une fois le premier écrit, n'écrit rien de plus", async () => {
    const { element, tape, soon } = await ouvre();
    await tape('app-declaration-gesture.death app-gesture-button button');
    await tape('app-sheet section.on .yes');
    const oui = element.querySelector<HTMLElement>('app-sheet section.on .yes');
    oui?.click();
    await soon(() => expect(element.querySelector('app-declaration-gesture.death app-stamp .stamp')).not.toBeNull());
    oui?.click();
    await soon(async () => expect(await ecrits()).toHaveLength(1));

    expect(await ecrits()).toHaveLength(1);
  });

  it("plus de morts que de vivants : la déclaration est écrite comme une autre, le gardien n'est pas bloqué", async () => {
    const { element, tape, soon } = await ouvre(contexte(uneBande({ liveCount: 1 })));
    await tape('app-declaration-gesture.death app-gesture-button button');
    await tape('app-sheet section.on .plus');
    await tape('app-sheet section.on .yes');
    await tape('app-sheet section.on .yes');

    await soon(() => expect(element.querySelector('.strip .alive')?.textContent).toContain('-1'));
    expect((await ecrits())[0]).toMatchObject({ fact: { type: 'Death', quantity: 2 } });
  });

  it("le téléphone ne peut pas garder la déclaration : pas de tampon, un post-it et la voix le disent — rien n'est montré comme écrit", async () => {
    const { element, tape, soon } = await ouvre(contexte(), { useFactory: () => Promise.reject(new OutboxUnavailable(new Error('quota'))) });
    await tape('app-declaration-gesture.death app-gesture-button button');
    await tape('app-sheet section.on .yes');
    await tape('app-sheet section.on .yes');

    await soon(() => expect(element.querySelector('app-declaration-gesture.death .failed')).not.toBeNull());
    expect(element.querySelector('app-declaration-gesture.death app-stamp .stamp')).toBeNull();
    expect(element.querySelector('app-declaration-gesture.death .failed')?.textContent).toContain('Le téléphone n’arrive plus à garder');
    await soon(() => expect(heard.at(-1)).toEqual(['wo/storage-full']));
  });
});
