import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { IDBFactory } from 'fake-indexeddb';
import type { CaretakerCampaign, CaretakerContext } from '@contracts';
import { STRAINS, weightBounds } from '@domain/journal';
import { provideHeardVoice } from '../../core/audio/testing';
import { CLOCK } from '../../core/clock';
import { REDUCE_PHOTO } from '../../core/media/reduce-photo';
import { fingerprintOf, MediaQueue } from '../../core/outbox/media-queue';
import { Outbox } from '../../core/outbox/outbox';
import { MEDIA_QUEUE, OUTBOX } from '../../core/sync/journal-sync';
import { NotebookPage } from '../notebook/notebook-page';

// Spec: backlog T.2 — la carte suit la demande ; T.3 — saisir un poids en grammes ; T.4 — le gardien
// pèse cinq poulets ; T.6 — la photo de la balance d'abord, obligatoire, puis le poids recopié
// depuis la photo ; cahier des charges « Les pesées » (décisions du 2026-11-12 : bornes de la moitié
// au double de la cible de la souche au jour J, jamais bloquantes ; l'afficheur imite la balance du
// poulailler, écran vert, poids écrit avec un point ; le pavé du téléphone).

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT = uuid(10);
const NORD = uuid(3);
const BANDE = uuid(4);
const OUSMANE = uuid(51);
const DEMANDE = uuid(70);
const token = `e30.${btoa(JSON.stringify({ sub: OUSMANE, tenant: TENANT })).replace(/=+$/, '')}.c2ln`;
// Friday October 16th, 2026, 08:00 in Dakar: day 28 of a flock placed on September 18th.
const NOW = new Date('2026-10-16T08:00:00.000Z');
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
const BORNES = weightBounds(STRAINS[0]!, 28);
// What the phone keeps of each photo: a small JPEG, different for each bird.
const photoDuPoulet = (rank: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, rank, rank, 0xff, 0xd9]);

const bande = (fields: Partial<CaretakerCampaign> = {}): CaretakerCampaign => ({
  campaignId: BANDE,
  placementDay: '2026-09-18',
  campaignDay: 28,
  liveCount: 980,
  journal: [],
  deliveries: [],
  weighingRequests: [{ weighingRequestId: DEMANDE, requestedFor: '2026-10-16' }],
  strain: 'Cobb500',
  ...fields,
});
const contexte = (campaign: CaretakerCampaign): CaretakerContext => ({
  chef: { name: 'Le gérant', phone: '+221770000003' },
  sites: [{ siteId: NORD, name: 'Poulailler Nord', timeZone: 'Africa/Dakar', today: '2026-10-16', primaryCaretakerId: OUSMANE, campaigns: [campaign] }],
});
const RECORDED = [
  'weighing-requested', 'weighing-photo', 'weighing-type-from-photo', 'weighing-camera-refused', 'weighing-implausible', 'weighing-next', 'weighing-all-done', 'weighing-sent', 'storage-full', 'photo-phone-full',
  ...[1, 2, 3, 4, 5].map((rank) => `weighing-chicken-${rank}`),
  'unit-kilo', 'unit-kilos', 'unit-grams', 'number-and',
  ...Array.from({ length: 101 }, (_, value) => `number-${value}`),
  ...[200, 300, 400, 500, 600, 700, 800, 900, 1000, 2000, 3000].map((value) => `number-${value}`),
];

describe('Le gardien pèse cinq poulets', () => {
  let heard: string[][];
  let outbox: Outbox;
  let media: MediaQueue;
  let reduced: number;
  let reduce: (file: File) => Promise<Uint8Array>;

  const ouvre = async (campaign: CaretakerCampaign) => {
    const voice = provideHeardVoice(RECORDED);
    heard = voice.heard;
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: OUTBOX, useValue: Promise.resolve(outbox) },
        { provide: MEDIA_QUEUE, useValue: Promise.resolve(media) },
        { provide: REDUCE_PHOTO, useValue: (file: File) => reduce(file) },
        { provide: CLOCK, useValue: { now: () => NOW } },
        ...voice.providers,
      ],
    });
    const fixture = TestBed.createComponent(NotebookPage);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/v1/caretaker/context').flush(contexte(campaign));
    const element = fixture.nativeElement as HTMLElement;
    const refresh = async () => {
      // No network in these tests: whatever leaves gets no answer, and nothing is lost.
      http.match(() => true).forEach((request) => request.error(new ProgressEvent('error')));
      await settle();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    await refresh();
    const tap = async (selector: string) => {
      const target = element.querySelector<HTMLElement>(`app-weighing-card ${selector}`);
      if (target === null) throw new Error(`Nothing to tap: ${selector}`);
      target.click();
      await refresh();
    };
    const keys = () => Array.from(element.querySelectorAll<HTMLButtonElement>('app-weighing-card app-keypad .key'));
    const type = async (digits: string) => {
      for (const digit of digits) {
        const key = keys().find((one) => one.textContent?.trim() === digit);
        if (key === undefined) throw new Error(`No key: ${digit}`);
        key.click();
        await refresh();
      }
    };
    /** « Photo de la balance », then the phone's camera gives back a picture. */
    const photographie = async () => {
      await tap('.shoot');
      const camera = element.querySelector<HTMLInputElement>('app-weighing-card input.camera');
      Object.defineProperty(camera, 'files', { value: [new File([new Uint8Array([1])], 'balance.jpg', { type: 'image/jpeg' })], configurable: true });
      camera?.dispatchEvent(new Event('change'));
      await vi.waitFor(async () => {
        await refresh();
        expect(element.querySelector('app-weighing-card app-scale-display')).not.toBeNull();
      });
    };
    /** One bird: the photo first, then the weight it shows. */
    const pese = async (grams: string) => {
      await photographie();
      await type(grams);
      await tap('.take');
    };
    const shown = () => element.querySelector('app-weighing-card app-scale-display .digits')?.textContent?.trim();
    const slots = () => Array.from(element.querySelectorAll('app-weighing-card .slot')).map((slot) => slot.textContent?.replace(/\s+/g, ' ').trim());
    const sendButton = () => element.querySelector<HTMLButtonElement>('app-weighing-card .send');
    return { element, tap, type, keys, photographie, pese, shown, slots, sendButton, refresh };
  };
  const said = () => heard.flat();

  beforeEach(async () => {
    localStorage.clear();
    localStorage.setItem('yaar.session', JSON.stringify({ token, expiresAt: '2099-01-01T00:00:00.000Z', role: 'collaborator', account: { name: 'Ousmane', avatar: 'baobab', language: 'fr' } }));
    outbox = await Outbox.open(new IDBFactory());
    media = await MediaQueue.open(new IDBFactory());
    reduced = 0;
    reduce = async () => photoDuPoulet((reduced += 1));
    // The phone's camera does not open in a test; every other input clicks as usual.
    const click = HTMLInputElement.prototype.click;
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      if (this.type !== 'file') click.call(this);
    });
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:balance-${reduced}`);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  describe('la carte', () => {
    it('sans demande du chef, aucune carte pesée', async () => {
      const { element } = await ouvre(bande({ weighingRequests: [] }));

      expect(element.querySelector('app-weighing-card .card')).toBeNull();
    });

    it('le chef a demandé : « Le chef demande : pèse 5 poulets », avec la balance et le bouton d’écoute', async () => {
      const { element } = await ouvre(bande());

      expect(element.querySelector('app-weighing-card .card')?.textContent?.replace(/\s+/g, ' ')).toContain('Le chef demande : pèse 5 poulets');
      expect(element.querySelector('app-weighing-card .card use')?.getAttribute('href')).toContain('scale');
    });
  });

  describe('la photo d’abord (T.6)', () => {
    it('« Je pèse » dit la consigne — des coins différents —, puis « Poulet 1 » et demande la photo de la balance ; sans photo, ni afficheur ni pavé', async () => {
      const { tap, element, slots, sendButton } = await ouvre(bande());

      await tap('.weigh');

      expect(element.querySelector('app-weighing-card .shoot')).not.toBeNull();
      expect(element.querySelector('app-weighing-card app-scale-display')).toBeNull();
      expect(element.querySelector('app-weighing-card app-keypad')).toBeNull();
      expect(slots()).toEqual(['1', '2', '3', '4', '5']);
      // « Envoyer » only once the five weights are taken: it never takes the place of the weight to type.
      expect(sendButton()).toBeNull();
      await vi.waitFor(() => expect(said()).toEqual(expect.arrayContaining(['fr/weighing-requested', 'fr/weighing-chicken-1', 'fr/weighing-photo'])));
      expect(said().indexOf('fr/weighing-requested')).toBeLessThan(said().indexOf('fr/weighing-chicken-1'));
    });

    it('la photo prise reste affichée au-dessus de l’afficheur, vide : le gardien recopie ce qu’il voit sur la photo', async () => {
      const { tap, photographie, element, shown } = await ouvre(bande());
      await tap('.weigh');

      await photographie();

      expect(element.querySelector<HTMLImageElement>('app-weighing-card .reading img.photo')?.getAttribute('src')).toBe('blob:balance-1');
      expect(element.querySelector('app-weighing-card .reading app-scale-display')).not.toBeNull();
      expect(element.querySelector('app-weighing-card app-keypad.compact')).not.toBeNull();
      expect(shown()).toBe('0.000');
      await vi.waitFor(() => expect(said()).toContain('fr/weighing-type-from-photo'));
    });

    it('la photo est une vignette à côté de l’afficheur : la toucher l’agrandit pour lire les chiffres, la toucher encore la referme', async () => {
      const { tap, photographie, element } = await ouvre(bande());
      await tap('.weigh');
      await photographie();

      expect(element.querySelector('app-weighing-card .zoom')).toBeNull();
      await tap('.reading .photo-button');
      expect(element.querySelector<HTMLImageElement>('app-weighing-card .zoom img')?.getAttribute('src')).toBe('blob:balance-1');
      await tap('.zoom');
      expect(element.querySelector('app-weighing-card .zoom')).toBeNull();
    });

    it('l’appareil photo qui ne s’ouvre pas se dit : sans photo, pas de pesée — appeler le chef', async () => {
      reduce = async () => {
        throw new Error('camera');
      };
      const { tap, photographie, element } = await ouvre(bande()).then(async (opened) => ({ ...opened, photographie: async () => {
        await opened.tap('.shoot');
        const camera = opened.element.querySelector<HTMLInputElement>('app-weighing-card input.camera');
        Object.defineProperty(camera, 'files', { value: [new File([new Uint8Array([1])], 'balance.jpg')], configurable: true });
        camera?.dispatchEvent(new Event('change'));
        await opened.refresh();
      } }));
      await tap('.weigh');

      await photographie();

      expect(element.querySelector('app-weighing-card [role=alert]')?.textContent).toContain('Appelle le chef');
      expect(element.querySelector('app-weighing-card app-scale-display')).toBeNull();
      await vi.waitFor(() => expect(said()).toContain('fr/weighing-camera-refused'));
    });
  });

  describe('le poids', () => {
    it('l’afficheur imite la balance du poulailler : « WEIGHT (kg) », les chiffres entrent par la droite avec un point — 1-8-2-0 → 1.820 ; la gomme retire le dernier', async () => {
      const { tap, type, photographie, shown, element } = await ouvre(bande());
      await tap('.weigh');
      await photographie();

      expect(element.querySelector('app-weighing-card app-scale-display .tag')?.textContent?.trim()).toBe('WEIGHT (kg)');
      await type('1');
      expect(shown()).toBe('0.001');
      await type('820');
      expect(shown()).toBe('1.820');
      await tap('app-keypad .erase');
      expect(shown()).toBe('0.182');
    });

    it('le pavé est rangé comme le clavier du téléphone : 1 2 3 / 4 5 6 / 7 8 9 / 0, et la gomme', async () => {
      const { tap, keys, photographie } = await ouvre(bande());
      await tap('.weigh');
      await photographie();

      expect(keys().map((key) => key.textContent?.trim() || key.getAttribute('aria-label'))).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'Effacer']);
    });

    it('un poids pris remplit sa case, et la voix le relit : « 1 kilo 820 grammes. C’est noté. Poulet suivant. » puis demande la photo suivante', async () => {
      const { tap, pese, slots, element } = await ouvre(bande());
      await tap('.weigh');
      heard.length = 0;

      await pese('1820');

      expect(slots()).toEqual(['1.820', '2', '3', '4', '5']);
      expect(element.querySelector('app-weighing-card .shoot')).not.toBeNull();
      await vi.waitFor(() => expect(said()).toEqual(expect.arrayContaining(['fr/number-1', 'fr/unit-kilo', 'fr/number-800', 'fr/number-20', 'fr/unit-grams', 'fr/weighing-next', 'fr/weighing-chicken-2', 'fr/weighing-photo'])));
    });

    it(`hors des bornes de la souche (à J28 : de ${BORNES.min} à ${BORNES.max} g), l’afficheur passe au rouge et la voix dit de regarder encore ; rien n’est pris`, async () => {
      const { tap, type, photographie, slots, element } = await ouvre(bande());
      await tap('.weigh');
      await photographie();

      await type('18');
      await tap('.take');

      expect(element.querySelector('app-weighing-card app-scale-display .display')?.classList.contains('wrong')).toBe(true);
      expect(slots()[0]).toBe('1');
      await vi.waitFor(() => expect(said()).toContain('fr/weighing-implausible'));
    });

    it('après l’avertissement, retaper efface le rouge ; ou un second geste « Garder ce poids » le prend quand même : jamais bloquant', async () => {
      const { tap, type, photographie, slots, element } = await ouvre(bande());
      await tap('.weigh');
      await photographie();
      await type('18');
      await tap('.take');

      expect(element.querySelector('app-weighing-card .take')?.textContent).toContain('Garder ce poids');
      await tap('.take');
      expect(slots()[0]).toBe('0.018');

      await photographie();
      await type('99999');
      await tap('.take');
      expect(element.querySelector('app-weighing-card app-scale-display .display')?.classList.contains('wrong')).toBe(true);
      await type('1');
      expect(element.querySelector('app-weighing-card app-scale-display .display')?.classList.contains('wrong')).toBe(false);
    });

    it('toucher une case remplie la reprend : une nouvelle photo, puis le nouveau poids la remplace', async () => {
      const { tap, pese, slots, element } = await ouvre(bande());
      await tap('.weigh');
      await pese('1820');
      await pese('1905');

      await tap('.slots li:nth-child(1) .slot');
      expect(element.querySelector('app-weighing-card .shoot')).not.toBeNull();
      await pese('1760');

      expect(slots()).toEqual(['1.760', '1.905', '3', '4', '5']);
    });
  });

  describe('envoyer', () => {
    it('cinq poids pris : Envoyer garde les cinq photos sur le téléphone, puis écrit la pesée, ses poids et leurs photos dans le même ordre — hors-ligne ; la carte se ferme', async () => {
      const { tap, pese, sendButton, element, refresh } = await ouvre(bande());
      await tap('.weigh');
      for (const grams of ['1820', '1905', '1760', '1880', '1850']) await pese(grams);

      expect(sendButton()?.disabled).toBe(false);
      await vi.waitFor(() => expect(said()).toContain('fr/weighing-all-done'));
      await tap('.send');

      const empreintes = await Promise.all([1, 2, 3, 4, 5].map((rank) => fingerprintOf(photoDuPoulet(rank))));
      await vi.waitFor(async () => {
        await refresh();
        expect((await outbox.toSend(OUSMANE)).map((entry) => entry.payload)).toEqual([
          expect.objectContaining({ siteId: NORD, campaignId: BANDE, businessDate: '2026-10-16', recordedAt: NOW.toISOString(), fact: { type: 'Weighing', weighingRequestId: DEMANDE, weights: [1820, 1905, 1760, 1880, 1850], photos: empreintes } }),
        ]);
      });
      expect((await media.toSend(OUSMANE)).map((entry) => [entry.sha256, entry.retention]).sort()).toEqual(empreintes.map((fingerprint) => [fingerprint, 'OperationalProof']).sort());
      await vi.waitFor(() => expect(said()).toContain('fr/weighing-sent'));
      expect(element.querySelector('app-weighing-card .card')).toBeNull();
    });

    it('une case reprise n’envoie que sa dernière photo', async () => {
      const { tap, pese, refresh } = await ouvre(bande());
      await tap('.weigh');
      for (const grams of ['1820', '1905', '1760', '1880', '1850']) await pese(grams);
      await tap('.slots li:nth-child(2) .slot');
      await pese('1900');

      await tap('.send');

      const empreintes = await Promise.all([1, 6, 3, 4, 5].map((rank) => fingerprintOf(photoDuPoulet(rank))));
      await vi.waitFor(async () => {
        await refresh();
        const [entry] = await outbox.toSend(OUSMANE);
        expect(entry?.payload).toEqual(expect.objectContaining({ fact: expect.objectContaining({ weights: [1820, 1900, 1760, 1880, 1850], photos: empreintes }) }));
      });
    });

    it('fermer la feuille avant d’envoyer n’écrit rien', async () => {
      const { tap, pese } = await ouvre(bande());
      await tap('.weigh');
      await pese('1820');

      await tap('.close');

      expect(await outbox.toSend(OUSMANE)).toEqual([]);
    });
  });
});
