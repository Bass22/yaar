import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { IDBFactory } from 'fake-indexeddb';
import type { CaretakerCampaign, CaretakerContext, CaretakerDeliveryLine } from '@contracts';
import { provideHeardVoice } from '../../core/audio/testing';
import { CLOCK } from '../../core/clock';
import { MediaQueue } from '../../core/outbox/media-queue';
import { Outbox } from '../../core/outbox/outbox';
import { MEDIA_QUEUE, OUTBOX } from '../../core/sync/journal-sync';
import { REDUCE_PHOTO } from '../../core/media/reduce-photo';
import { NotebookPage } from '../notebook/notebook-page';

// Spec: backlog Q.7 — le gardien compte la livraison ; Q.8 — le papier du livreur ; cahier des
// charges « Livraison annoncée » (décisions du 2026-11-11 : une réception par ligne, les poussins en
// cartons de 50, une photo du papier par arrivée) ; maquette journal-gardien.html (carte livraison,
// paquets de 4, feuille du papier). Jamais un prix sur le téléphone.

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT = uuid(10);
const NORD = uuid(3);
const BANDE = uuid(4);
const OUSMANE = uuid(51);
const ALIMENT = uuid(21);
const POUSSINS = uuid(22);
const token = `e30.${btoa(JSON.stringify({ sub: OUSMANE, tenant: TENANT })).replace(/=+$/, '')}.c2ln`;
// Friday October 16th, 2026, 08:00 in Dakar.
const NOW = new Date('2026-10-16T08:00:00.000Z');
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
const PAPIER = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 7, 7, 0xff, 0xd9]);

// The order of 12/10: 8 bags of 20 already received, 1 000 chicks to come.
const aliment = (fields: Partial<CaretakerDeliveryLine> = {}): CaretakerDeliveryLine => ({ orderLineId: ALIMENT, name: 'Aliment démarrage', category: 'Feed', expected: 20, received: 8, remaining: 12, ...fields });
const poussins = (fields: Partial<CaretakerDeliveryLine> = {}): CaretakerDeliveryLine => ({ orderLineId: POUSSINS, name: 'Poussins Cobb', category: 'Chicks', expected: 1000, received: 0, remaining: 1000, ...fields });
const bande = (lines: CaretakerDeliveryLine[], fields: Partial<CaretakerCampaign> = {}): CaretakerCampaign => ({
  campaignId: BANDE,
  placementDay: '2026-10-14',
  campaignDay: 2,
  liveCount: null,
  journal: [],
  deliveries: lines.length === 0 ? [] : [{ orderId: uuid(20), lines }],
  ...fields,
});
const contexte = (campaign: CaretakerCampaign): CaretakerContext => ({
  chef: { name: 'Le gérant', phone: '+221770000003' },
  sites: [{ siteId: NORD, name: 'Poulailler Nord', timeZone: 'Africa/Dakar', today: '2026-10-16', primaryCaretakerId: OUSMANE, campaigns: [campaign] }],
});
const RECORDED = [
  'delivery-choose', 'delivery-how-many', 'delivery-how-many-boxes', 'delivery-how-many-units', 'delivery-received', 'delivery-received-boxes', 'delivery-received-units',
  'delivery-short', 'delivery-expected', 'delivery-bonus', 'confirm', 'delivery-paper', 'delivery-paper-saved', 'delivery-paper-camera-refused', 'written-thanks', 'photo-phone-full', 'storage-full',
  'number-and',
  ...Array.from({ length: 101 }, (_, value) => `number-${value}`),
];

describe('Le gardien compte la livraison', () => {
  let heard: string[][];
  let outbox: Outbox;
  let media: MediaQueue;

  const ouvre = async (campaign: CaretakerCampaign) => {
    const voice = provideHeardVoice(RECORDED);
    heard = voice.heard;
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: OUTBOX, useValue: Promise.resolve(outbox) },
        { provide: MEDIA_QUEUE, useValue: Promise.resolve(media) },
        { provide: REDUCE_PHOTO, useValue: async () => PAPIER },
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
    const card = () => element.querySelector('app-delivery-card');
    const tap = async (selector: string) => {
      const target = element.querySelector<HTMLElement>(`app-delivery-card ${selector}`);
      if (target === null) throw new Error(`Nothing to tap: ${selector}`);
      target.click();
      await refresh();
    };
    const sheet = (title: string) => Array.from(element.querySelectorAll<HTMLElement>('app-delivery-card section[role=dialog]')).find((one) => one.getAttribute('aria-label') === title && one.classList.contains('on')) ?? null;
    const inSheet = async (title: string, selector: string) => {
      const target = sheet(title)?.querySelector<HTMLElement>(selector);
      if (target === null || target === undefined) throw new Error(`Nothing to tap in « ${title} »: ${selector}`);
      target.click();
      await refresh();
    };
    const counted = () => element.querySelector('app-delivery-card app-counter output')?.textContent?.trim();
    const setCount = async (value: number) => {
      for (let guard = 0; guard < 200 && Number(counted()) !== value; guard += 1) {
        await inSheet(sheet('Poussins Cobb') === null ? 'Aliment démarrage' : 'Poussins Cobb', Number(counted()) < value ? '.plus' : '.minus');
      }
    };
    const soon = (check: () => void | Promise<void>) =>
      vi.waitFor(async () => {
        await refresh();
        await check();
      });
    return { element, card, tap, sheet, inSheet, counted, setCount, soon, refresh };
  };
  const said = () => heard.flat();

  beforeEach(async () => {
    localStorage.clear();
    localStorage.setItem('yaar.session', JSON.stringify({ token, expiresAt: '2099-01-01T00:00:00.000Z', role: 'collaborator', account: { name: 'Ousmane', avatar: 'baobab', language: 'fr' } }));
    outbox = await Outbox.open(new IDBFactory());
    media = await MediaQueue.open(new IDBFactory());
    // The phone's camera does not open in a test; every other input clicks as usual.
    const click = HTMLInputElement.prototype.click;
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      if (this.type !== 'file') click.call(this);
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:papier');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  describe('la carte', () => {
    it("n'apparaît que si une commande annoncée attend encore quelque chose", async () => {
      const { card } = await ouvre(bande([]));

      expect(card()?.querySelector('.card')).toBeNull();
    });

    it('dit ce que le chef a commandé et ce qui reste à venir, ligne par ligne : des sacs, des cartons de poussins — jamais un prix', async () => {
      const { card } = await ouvre(bande([aliment(), poussins()]));

      expect(Array.from(card()?.querySelectorAll('.expected li') ?? []).map((line) => line.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['Aliment démarrage reste 12 sacs', 'Poussins Cobb reste 20 cartons']);
      expect(card()?.querySelector('.expected li use')?.getAttribute('href')).toContain('closed-bag');
      expect(card()?.textContent).not.toMatch(/F\b|prix|€/);
    });
  });

  describe('compter', () => {
    it("une seule ligne attendue : « C'est arrivé » ouvre le compteur, pré-rempli avec ce qui reste, et la voix dit quoi compter", async () => {
      const { tap, counted, sheet } = await ouvre(bande([aliment()]));

      await tap('.arrive');

      expect(sheet('Aliment démarrage')).not.toBeNull();
      expect(counted()).toBe('12');
      await vi.waitFor(() => expect(said()).toContain('fr/delivery-how-many'));
    });

    it("plusieurs lignes : le gardien touche ce que le camion a apporté — rien n'est choisi d'avance — puis compte ; les poussins en cartons", async () => {
      const { tap, inSheet, sheet, counted, element } = await ouvre(bande([aliment(), poussins()]));

      await tap('.arrive');
      expect(sheet("Qu'est-ce qui est arrivé ?")).not.toBeNull();
      expect(Array.from(element.querySelectorAll<HTMLInputElement>('app-delivery-card .tile input')).map((input) => input.checked)).toEqual([false, false]);
      expect(sheet("Qu'est-ce qui est arrivé ?")?.querySelector<HTMLButtonElement>('.yes')?.disabled).toBe(true);
      await inSheet("Qu'est-ce qui est arrivé ?", '.tile:nth-child(2) input');
      await inSheet("Qu'est-ce qui est arrivé ?", '.yes');

      expect(sheet('Poussins Cobb')).not.toBeNull();
      expect(counted()).toBe('20');
      await vi.waitFor(() => expect(said()).toContain('fr/delivery-how-many-boxes'));
    });

    it('un manque se dit, avec ce que le chef attendait', async () => {
      const { tap, inSheet, setCount, sheet } = await ouvre(bande([aliment()]));

      await tap('.arrive');
      await setCount(10);
      await inSheet('Aliment démarrage', '.yes');

      expect(sheet("C'est bien ça ?")?.textContent).toContain('10 sacs reçus');
      expect(sheet("C'est bien ça ?")?.querySelector('.variance.short')?.textContent).toContain('Il en manque : le chef en attendait 12 sacs.');
      await vi.waitFor(() => expect(said()).toEqual(expect.arrayContaining(['fr/delivery-received', 'fr/delivery-short', 'fr/delivery-expected', 'fr/confirm'])));
    });

    it('un bonus se dit aussi bien que le manque : un carton de plus que la commande', async () => {
      const { tap, inSheet, setCount, sheet } = await ouvre(bande([poussins()]));

      await tap('.arrive');
      await setCount(21);
      await inSheet('Poussins Cobb', '.yes');

      expect(sheet("C'est bien ça ?")?.querySelector('.variance.bonus')?.textContent).toContain('C’est un bonus : 1 carton de plus que la commande.');
      await vi.waitFor(() => expect(said()).toEqual(expect.arrayContaining(['fr/delivery-received-boxes', 'fr/delivery-bonus'])));
    });

    it('Non revient au compteur, avec le compte laissé', async () => {
      const { tap, inSheet, setCount, sheet, counted } = await ouvre(bande([aliment()]));

      await tap('.arrive');
      await setCount(10);
      await inSheet('Aliment démarrage', '.yes');
      await inSheet("C'est bien ça ?", '.no');

      expect(sheet('Aliment démarrage')).not.toBeNull();
      expect(counted()).toBe('10');
    });
  });

  describe('le papier du livreur, puis la réception écrite', () => {
    it('« Pas de papier » termine sans blocage : 21 cartons écrits comme 1 050 poussins reçus, sans papier, pour le jour choisi', async () => {
      const { tap, inSheet, setCount, sheet, soon } = await ouvre(bande([poussins()]));

      await tap('.arrive');
      await setCount(21);
      await inSheet('Poussins Cobb', '.yes');
      await inSheet("C'est bien ça ?", '.yes');
      expect(sheet('Le papier du livreur')).not.toBeNull();
      await vi.waitFor(() => expect(said()).toContain('fr/delivery-paper'));
      await inSheet('Le papier du livreur', '.paper-none');

      await soon(async () => {
        expect((await outbox.toSend(OUSMANE)).map((entry) => entry.payload)).toEqual([
          expect.objectContaining({ siteId: NORD, campaignId: BANDE, businessDate: '2026-10-16', recordedAt: NOW.toISOString(), fact: { type: 'Delivery', orderLineId: POUSSINS, receivedQuantity: 1050, deliveryNote: { kind: 'NoPaper' } } }),
        ]);
      });
      await vi.waitFor(() => expect(said()).toContain('fr/written-thanks'));
    });

    it('dans le journal du jour, la réception dit ce qui est arrivé, avec son picto : des poussins, pas des sacs', async () => {
      const { tap, inSheet, element, soon } = await ouvre(bande([poussins()]));

      await tap('.arrive');
      await inSheet('Poussins Cobb', '.yes');
      await inSheet("C'est bien ça ?", '.yes');
      await inSheet('Le papier du livreur', '.paper-none');

      await soon(() => expect(element.querySelector('app-day-journal .line .words b')?.textContent?.replace(/\s/g, ' ')).toBe('Poussins Cobb : 1 000 reçus'));
      expect(element.querySelector('app-day-journal .line .what use')?.getAttribute('href')).toContain('chick');
    });

    it('deux lignes arrivées ensemble, un seul papier photographié : deux réceptions, le même papier, gardé comme pièce justificative', async () => {
      const { tap, inSheet, soon } = await ouvre(bande([aliment(), poussins()]));

      await tap('.arrive');
      await inSheet("Qu'est-ce qui est arrivé ?", '.tile:nth-child(1) input');
      await inSheet("Qu'est-ce qui est arrivé ?", '.tile:nth-child(2) input');
      await inSheet("Qu'est-ce qui est arrivé ?", '.yes');
      await inSheet('Aliment démarrage', '.yes');
      await inSheet("C'est bien ça ?", '.yes');
      await inSheet('Poussins Cobb', '.yes');
      await inSheet("C'est bien ça ?", '.yes');
      await inSheet('Le papier du livreur', '.paper-photo');
      const camera = document.querySelector<HTMLInputElement>('app-delivery-card input[type=file]');
      Object.defineProperty(camera, 'files', { value: [new File([PAPIER], 'papier.jpg', { type: 'image/jpeg' })], configurable: true });
      camera?.dispatchEvent(new Event('change'));
      await soon(() => expect(document.querySelector<HTMLImageElement>('app-delivery-card .viewfinder img')?.src).toBe('blob:papier'));
      await inSheet('Le papier du livreur', '.yes');

      await soon(async () => {
        const [kept] = await media.waiting(OUSMANE);
        // A delivery note is a supporting document: kept on the server for the legal time (architecture §7).
        expect((await media.toSend(OUSMANE)).map(({ retention }) => retention)).toEqual(['SupportingDocument']);
        const written = (await outbox.toSend(OUSMANE)).map((entry) => ('fact' in entry.payload ? entry.payload.fact : null));
        expect(written).toEqual([
          { type: 'Delivery', orderLineId: ALIMENT, receivedQuantity: 12, deliveryNote: { kind: 'Photographed', media: kept?.sha256 } },
          { type: 'Delivery', orderLineId: POUSSINS, receivedQuantity: 1000, deliveryNote: { kind: 'Photographed', media: kept?.sha256 } },
        ]);
      });
      await vi.waitFor(() => expect(said()).toContain('fr/delivery-paper-saved'));
    });

    it('après une réception partielle, la carte reste ouverte avec « reste N à venir », hors-ligne compris', async () => {
      const { tap, inSheet, setCount, card, soon } = await ouvre(bande([aliment()]));

      await tap('.arrive');
      await setCount(10);
      await inSheet('Aliment démarrage', '.yes');
      await inSheet("C'est bien ça ?", '.yes');
      await inSheet('Le papier du livreur', '.paper-none');

      await soon(() => expect(card()?.querySelector('.expected li')?.textContent?.replace(/\s+/g, ' ')).toContain('reste 2 sacs'));
    });

    it('les poussins comptés hors-ligne font connaître les vivants, sans attendre le réseau', async () => {
      const { tap, inSheet, element, soon } = await ouvre(bande([poussins()]));

      await tap('.arrive');
      await inSheet('Poussins Cobb', '.yes');
      await inSheet("C'est bien ça ?", '.yes');
      await inSheet('Le papier du livreur', '.paper-none');

      await soon(() => expect(element.querySelector('app-day-strip')?.textContent?.replace(/\s/g, '')).toContain('1000'));
    });
  });
});
