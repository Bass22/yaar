import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { IDBFactory } from 'fake-indexeddb';
import type { CaretakerContext } from '@contracts';
import { provideHeardVoice } from '../../../core/audio/testing';
import { CLOCK } from '../../../core/clock';
import { MediaQueue } from '../../../core/outbox/media-queue';
import { Outbox } from '../../../core/outbox/outbox';
import { MEDIA_QUEUE, OUTBOX } from '../../../core/sync/journal-sync';
import { NotebookPage } from '../../notebook/notebook-page';
import { REDUCE_PHOTO, reducedSize } from './reduce-photo';

// Spec: backlog M.3 — envoyer une photo au chef ; cahier des charges « La photo au chef » (décision
// du 2026-11-11) ; maquette journal-gardien.html (« Prévenir le chef », Photo, .viseur) ; M.2 — la
// photo part avec le réseau sans retenir la déclaration.

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT = uuid(10);
const NORD = uuid(3);
const BANDE = uuid(4);
const OUSMANE = uuid(51);
const token = `e30.${btoa(JSON.stringify({ sub: OUSMANE, tenant: TENANT })).replace(/=+$/, '')}.c2ln`;
// Friday November 6th, 2026, 08:00 in Dakar.
const NOW = new Date('2026-11-06T08:00:00.000Z');
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
// What the phone keeps once reduced: a small JPEG.
const REDUITE = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 8, 0, 0, 0xff, 0xd9]);

const contexte = (campaigns: CaretakerContext['sites'][number]['campaigns'] = [{ campaignId: BANDE, placementDay: '2026-10-25', campaignDay: 12, liveCount: null, journal: [], deliveries: [] }]): CaretakerContext => ({
  chef: { name: 'Le gérant', phone: '+221770000003' },
  sites: [{ siteId: NORD, name: 'Poulailler Nord', timeZone: 'Africa/Dakar', today: '2026-11-06', primaryCaretakerId: OUSMANE, campaigns }],
});

describe('La photo au chef', () => {
  let heard: string[][];
  let outbox: Outbox;
  let media: MediaQueue;
  let reducer: (file: Blob) => Promise<Uint8Array>;

  const ouvre = async (context = contexte(), queue: Promise<MediaQueue | null> = Promise.resolve(media)) => {
    const voice = provideHeardVoice(['photo-take', 'photo-sent', 'photo-camera-refused', 'photo-phone-full', 'storage-full']);
    heard = voice.heard;
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: OUTBOX, useValue: Promise.resolve(outbox) },
        { provide: MEDIA_QUEUE, useValue: queue },
        { provide: REDUCE_PHOTO, useValue: (file: Blob) => reducer(file) },
        { provide: CLOCK, useValue: { now: () => NOW } },
        ...voice.providers,
      ],
    });
    const fixture = TestBed.createComponent(NotebookPage);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/v1/caretaker/context').flush(context);
    const element = fixture.nativeElement as HTMLElement;
    const refresh = async () => {
      await settle();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    await refresh();
    // No network for the phone in these tests: nothing answers, nothing leaves.
    const silence = () => http.match(() => true).forEach((request) => request.error(new ProgressEvent('error')));
    silence();
    const camera = () => element.querySelector<HTMLInputElement>('app-photo-gesture input[type=file]');
    const shoot = async (file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'photo.jpg', { type: 'image/jpeg' })) => {
      element.querySelector<HTMLElement>('app-photo-gesture app-gesture-button button')?.click();
      await refresh();
      const input = camera();
      if (input === null) throw new Error('No camera');
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new Event('change'));
      await refresh();
    };
    const soon = (check: () => void | Promise<void>) =>
      vi.waitFor(async () => {
        silence();
        await refresh();
        await check();
      });
    return { element, refresh, shoot, camera, soon, silence };
  };

  beforeEach(async () => {
    localStorage.clear();
    localStorage.setItem('yaar.session', JSON.stringify({ token, expiresAt: '2099-01-01T00:00:00.000Z', role: 'collaborator', account: { name: 'Ousmane', avatar: 'baobab', language: 'fr' } }));
    outbox = await Outbox.open(new IDBFactory());
    media = await MediaQueue.open(new IDBFactory());
    reducer = async () => REDUITE;
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:photo');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it('« Photo » est à côté de « Parler » quand une bande est en cours ; il ouvre l’appareil photo du téléphone, et la voix dit quoi faire', async () => {
    const { element, camera } = await ouvre();

    expect(Array.from(element.querySelectorAll('.talk app-gesture-button')).map((button) => button.textContent?.trim())).toEqual(['Parler', 'Photo']);
    expect([camera()?.accept, camera()?.getAttribute('capture')]).toEqual(['image/*', 'environment']);
    element.querySelector<HTMLElement>('app-photo-gesture app-gesture-button button')?.click();
    expect(HTMLInputElement.prototype.click).toHaveBeenCalled();
    await vi.waitFor(() => expect(heard).toContainEqual(['fr/photo-take']));
  });

  it('sans bande en cours, pas de « Photo » : une photo s’écrit au cahier d’une bande', async () => {
    const { element } = await ouvre(contexte([]));

    expect(element.querySelector('app-photo-gesture')).toBeNull();
  });

  it('la photo prise apparaît dans le viseur, réduite ; Oui la garde sur le téléphone puis l’écrit au cahier, la voix dit « C’est noté »', async () => {
    let reduced: Blob | null = null;
    reducer = async (file) => {
      reduced = file;
      return REDUITE;
    };
    const { element, shoot, soon } = await ouvre();

    await shoot();
    expect(reduced).not.toBeNull();
    expect(element.querySelector<HTMLImageElement>('app-photo-gesture .viewfinder')?.src).toBe('blob:photo');
    element.querySelector<HTMLElement>('app-photo-gesture .yes')?.click();

    await soon(async () => {
      const [kept] = await media.waiting(OUSMANE);
      const [written] = await outbox.toSend(OUSMANE);
      expect(written?.payload).toMatchObject({ siteId: NORD, campaignId: BANDE, businessDate: '2026-11-06', recordedAt: NOW.toISOString(), fact: { type: 'Photo', media: kept?.sha256 } });
    });
    await vi.waitFor(() => expect(heard).toContainEqual(['fr/photo-sent']));
  });

  it('dans le journal du jour, une photo partie avant son image garde l’horloge et dit « photo pas encore partie »', async () => {
    // The event reached the server; its photo still waits on the phone.
    const fingerprint = await media.keep(OUSMANE, REDUITE, 'image/jpeg', 'OperationalProof');
    const sent = { id: uuid(301), businessDate: '2026-11-06', recordedAt: '2026-11-06T07:30:00.000Z', author: { id: OUSMANE, name: 'Ousmane' }, fact: { type: 'Photo' as const, media: fingerprint }, corrected: false, retracted: false };
    const { element, soon } = await ouvre(contexte([{ campaignId: BANDE, placementDay: '2026-10-25', campaignDay: 12, liveCount: null, journal: [sent], deliveries: [] }]));

    await soon(() => expect(element.querySelector('app-day-journal .line')?.textContent).toContain('Photo'));
    expect(element.querySelector('app-day-journal .line')?.textContent).toContain('photo pas encore partie');
    expect(element.querySelector('app-day-journal .line .state use')?.getAttribute('href')).toContain('stamp-pending');
  });

  it('une fois l’image sur le serveur, la ligne dit « bien envoyé »', async () => {
    const sent = { id: uuid(302), businessDate: '2026-11-06', recordedAt: '2026-11-06T07:30:00.000Z', author: { id: OUSMANE, name: 'Ousmane' }, fact: { type: 'Photo' as const, media: 'c'.repeat(64) }, corrected: false, retracted: false };
    const { element, soon } = await ouvre(contexte([{ campaignId: BANDE, placementDay: '2026-10-25', campaignDay: 12, liveCount: null, journal: [sent], deliveries: [] }]));

    await soon(() => expect(element.querySelector('app-day-journal .line')?.textContent).toContain('bien envoyé'));
  });

  it('la croix abandonne la photo : rien n’est gardé, rien n’est écrit', async () => {
    const { element, shoot, refresh } = await ouvre();

    await shoot();
    element.querySelector<HTMLElement>('app-photo-gesture .no')?.click();
    await refresh();

    expect(await media.waiting(OUSMANE)).toEqual([]);
    expect(await outbox.toSend(OUSMANE)).toEqual([]);
    expect(element.querySelector('app-photo-gesture .viewfinder')).toBeNull();
  });

  it('l’appareil photo refermé sans photo : rien ne s’ouvre, rien n’est dit', async () => {
    const { element, camera, refresh } = await ouvre();
    element.querySelector<HTMLElement>('app-photo-gesture app-gesture-button button')?.click();
    Object.defineProperty(camera(), 'files', { value: [], configurable: true });
    camera()?.dispatchEvent(new Event('change'));
    await refresh();

    expect(element.querySelector('app-photo-gesture .viewfinder')).toBeNull();
    expect(element.querySelector('app-photo-gesture .trouble')).toBeNull();
  });

  it('une photo illisible (appareil en panne) : un post-it avec le picto, et la voix le dit ; rien n’est écrit', async () => {
    reducer = async () => {
      throw new Error('not an image');
    };
    const { element, shoot } = await ouvre();

    await shoot();

    expect(element.querySelector('app-photo-gesture .trouble')?.textContent).toContain('L’appareil photo ne s’ouvre pas');
    expect(element.querySelector('app-photo-gesture .trouble use')?.getAttribute('href')).toContain('camera');
    await vi.waitFor(() => expect(heard).toContainEqual(['fr/photo-camera-refused']));
    expect(await outbox.toSend(OUSMANE)).toEqual([]);
  });

  it('trop de photos en attente : la photo n’est pas gardée, rien n’est écrit, le post-it et la voix le disent', async () => {
    const full = await MediaQueue.open(new IDBFactory(), 4);
    const { element, shoot, soon } = await ouvre(contexte(), Promise.resolve(full));

    await shoot();
    element.querySelector<HTMLElement>('app-photo-gesture .yes')?.click();

    await soon(() => expect(element.querySelector('app-photo-gesture .trouble')?.textContent).toContain('plein de photos'));
    await vi.waitFor(() => expect(heard).toContainEqual(['fr/photo-phone-full']));
    expect(await outbox.toSend(OUSMANE)).toEqual([]);
  });

  it('la réduction ramène le grand côté à 800 px, sans agrandir ni déformer', () => {
    expect([reducedSize(4000, 3000), reducedSize(1080, 1920), reducedSize(640, 480), reducedSize(800, 800)]).toEqual([
      { width: 800, height: 600 },
      { width: 450, height: 800 },
      { width: 640, height: 480 },
      { width: 800, height: 800 },
    ]);
  });
});
