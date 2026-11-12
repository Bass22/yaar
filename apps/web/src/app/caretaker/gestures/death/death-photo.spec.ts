import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { IDBFactory } from 'fake-indexeddb';
import type { CaretakerContext } from '@contracts';
import { provideHeardVoice } from '../../../core/audio/testing';
import { CLOCK } from '../../../core/clock';
import { REDUCE_PHOTO } from '../../../core/media/reduce-photo';
import { fingerprintOf, MediaQueue } from '../../../core/outbox/media-queue';
import { Outbox } from '../../../core/outbox/outbox';
import { MEDIA_QUEUE, OUTBOX } from '../../../core/sync/journal-sync';
import { NotebookPage } from '../../notebook/notebook-page';

// Spec: backlog K.6 — la photo des morts ; cahier des charges « Photo des morts » (décisions du
// 2026-11-08 et du 2026-11-12) : toujours répondue, jamais bloquante ; deux Oui à la relecture ; la
// consigne du fondateur, dite quand l'appareil s'ouvre : « Prends en photo tous les morts, dans un
// endroit bien éclairé. »

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT = uuid(10);
const NORD = uuid(3);
const BANDE = uuid(4);
const OUSMANE = uuid(51);
const token = `e30.${btoa(JSON.stringify({ sub: OUSMANE, tenant: TENANT })).replace(/=+$/, '')}.c2ln`;
// Friday November 6th, 2026, 08:00 in Dakar.
const NOW = new Date('2026-11-06T08:00:00.000Z');
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
const MORTS = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 3, 3, 0xff, 0xd9]);
const contexte = (): CaretakerContext => ({
  chef: null,
  sites: [{ siteId: NORD, name: 'Poulailler Nord', timeZone: 'Africa/Dakar', today: '2026-11-06', primaryCaretakerId: OUSMANE, campaigns: [{ campaignId: BANDE, placementDay: '2026-10-15', campaignDay: 22, liveCount: 938, journal: [], deliveries: [], weighingRequests: [], strain: 'Cobb500' }] }],
});

describe('La photo des morts', () => {
  let outbox: Outbox;
  let media: MediaQueue;
  let heard: string[][];
  let reduce: () => Promise<Uint8Array>;

  const ouvre = async () => {
    const voice = provideHeardVoice(['deaths-how-many', 'deaths-today-1', 'deaths-today-2', 'confirm', 'deaths-show', 'deaths-photo-advice', 'deaths-camera-refused', 'written-thanks', 'storage-full', 'bags-how-many', 'bags-today-1']);
    heard = voice.heard;
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: OUTBOX, useValue: Promise.resolve(outbox) },
        { provide: MEDIA_QUEUE, useValue: Promise.resolve(media) },
        { provide: REDUCE_PHOTO, useValue: () => reduce() },
        { provide: CLOCK, useValue: { now: () => NOW } },
        ...voice.providers,
      ],
    });
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(NotebookPage);
    fixture.detectChanges();
    http.expectOne('/api/v1/caretaker/context').flush(contexte());
    const element = fixture.nativeElement as HTMLElement;
    const refresh = async () => {
      http.match(() => true).forEach((request) => request.error(new ProgressEvent('error')));
      await settle();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    const tape = async (selector: string) => {
      const target = element.querySelector<HTMLElement>(selector);
      if (target === null) throw new Error(`Nothing to tap: ${selector}`);
      target.click();
      await refresh();
    };
    /** Mort → C'est tout: the read-back of the deaths is open. */
    const relecture = async () => {
      await tape('app-declaration-gesture.death app-gesture-button button');
      await tape('app-declaration-gesture.death app-sheet section.on .yes');
    };
    /** The phone's camera gives back a picture. */
    const photographie = async () => {
      const camera = element.querySelector<HTMLInputElement>('app-declaration-gesture.death input.camera');
      Object.defineProperty(camera, 'files', { value: [new File([new Uint8Array([1])], 'morts.jpg', { type: 'image/jpeg' })], configurable: true });
      camera?.dispatchEvent(new Event('change'));
      await refresh();
    };
    const soon = (check: () => void | Promise<void>) =>
      vi.waitFor(async () => {
        await refresh();
        await check();
      });
    await refresh();
    return { element, tape, relecture, photographie, soon };
  };
  const ecrits = async () => (await outbox.entriesOf(BANDE)).map((entry) => entry.payload);
  const said = () => heard.flat();

  beforeEach(async () => {
    localStorage.clear();
    localStorage.setItem('yaar.session', JSON.stringify({ token, expiresAt: '2099-01-01T00:00:00.000Z', role: 'collaborator', account: { name: 'Ousmane', avatar: 'baobab', language: 'fr' } }));
    outbox = await Outbox.open(new IDBFactory());
    media = await MediaQueue.open(new IDBFactory());
    reduce = async () => MORTS;
    const click = HTMLInputElement.prototype.click;
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      if (this.type !== 'file') click.call(this);
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('la relecture des morts offre deux Oui — « Oui, je montre » et « Oui, pas de photo » —, et la voix demande s’il les montre', async () => {
    const { element, relecture } = await ouvre();

    await relecture();

    const sheet = element.querySelector('app-declaration-gesture.death app-sheet section.on');
    expect(sheet?.querySelector('.show')?.textContent?.trim()).toBe('Oui, je montre');
    expect(sheet?.querySelector('.no-photo')?.textContent?.trim()).toBe('Oui, pas de photo');
    await vi.waitFor(() => expect(said()).toEqual(expect.arrayContaining(['fr/deaths-today-1', 'fr/deaths-show'])));
  });

  it('« Oui, pas de photo » écrit tout de suite, avec sa réponse : trois taps, jamais bloquant', async () => {
    const { relecture, tape, soon } = await ouvre();
    await relecture();

    await tape('app-declaration-gesture.death app-sheet section.on .no-photo');

    await soon(async () => expect(await ecrits()).toEqual([expect.objectContaining({ fact: { type: 'Death', quantity: 1, deathEvidence: { kind: 'NoPhoto' } } })]));
  });

  it('« Oui, je montre » dit la consigne — tous les morts, dans un endroit bien éclairé — et ouvre l’appareil ; la photo part en preuve, la déclaration la cite', async () => {
    const { relecture, tape, photographie, soon } = await ouvre();
    await relecture();

    await tape('app-declaration-gesture.death app-sheet section.on .show');
    await vi.waitFor(() => expect(said()).toContain('fr/deaths-photo-advice'));
    await photographie();

    const empreinte = await fingerprintOf(MORTS);
    await soon(async () => expect(await ecrits()).toEqual([expect.objectContaining({ fact: { type: 'Death', quantity: 1, deathEvidence: { kind: 'Photographed', media: empreinte } } })]));
    expect((await media.toSend(OUSMANE)).map((entry) => [entry.sha256, entry.retention])).toEqual([[empreinte, 'OperationalProof']]);
  });

  it('l’appareil refuse : les morts s’écrivent « pas de photo », l’écran et la voix le disent', async () => {
    reduce = async () => {
      throw new Error('camera');
    };
    const { relecture, tape, photographie, soon, element } = await ouvre();
    await relecture();

    await tape('app-declaration-gesture.death app-sheet section.on .show');
    await photographie();

    await soon(async () => expect(await ecrits()).toEqual([expect.objectContaining({ fact: { type: 'Death', quantity: 1, deathEvidence: { kind: 'NoPhoto' } } })]));
    expect(element.querySelector('app-declaration-gesture.death [role=alert]')?.textContent).toContain('L’appareil photo ne s’ouvre pas. Les morts sont écrits sans photo.');
    await vi.waitFor(() => expect(said()).toContain('fr/deaths-camera-refused'));
  });

  it('un sac ouvert garde un seul Oui : on ne photographie que les morts', async () => {
    const { element, tape } = await ouvre();

    await tape('app-declaration-gesture.bag app-gesture-button button');
    await tape('app-declaration-gesture.bag app-sheet section.on .yes');

    const sheet = element.querySelector('app-declaration-gesture.bag app-sheet section.on');
    expect(sheet?.querySelector('.show')).toBeNull();
    expect(sheet?.querySelectorAll('.yes')).toHaveLength(1);
  });
});
