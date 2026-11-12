import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { IDBFactory } from 'fake-indexeddb';
import type { CaretakerContext, WeighingsView } from '@contracts';
import { STRAINS, targetAt, weightBounds } from '@domain/journal';
import { provideHeardVoice } from '../../core/audio/testing';
import { CLOCK } from '../../core/clock';
import { OfficeQueue } from '../../core/outbox/office-queue';
import { adminRoutes } from '../admin.routes';
import { OFFICE_QUEUE } from '../office-sync';

// Spec: backlog T.2 — l'admin demande une pesée ; T.5 — l'admin valide une pesée ; cahier des charges
// « Les pesées » (décisions du 2026-11-12 : une page « Pesées à valider » dans les lots en attendant
// l'inbox ; corriger au clavier, la moyenne suit — calculée par domain/journal ; valider écrit au
// journal la correction puis la validation). Corriger demande le réseau (CLAUDE.md §4, règle 3).

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT = uuid(10);
const LE_GERANT = uuid(54);
const NORD = uuid(3);
const BANDE = uuid(4);
const DEMANDE = uuid(70);
const PESEE = uuid(203);
const token = `e30.${btoa(JSON.stringify({ sub: LE_GERANT, tenant: TENANT })).replace(/=+$/, '')}.c2ln`;
// Monday November 9th, 2026, 10:00 in Dakar: day 28 of a flock placed on October 12th.
const NOW = new Date('2026-11-09T10:00:00.000Z');
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CIBLE_J14 = targetAt(STRAINS[0]!, 14)!.weight;
const CIBLE_J28 = targetAt(STRAINS[0]!, 28)!.weight;
// The photo of the scale for each bird (T.6).
const PHOTOS = ['a', 'b', 'c', 'd', 'e'].map((digit) => digit.repeat(64));
const milliers = (grams: number) => String(grams).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

const contexte = (): CaretakerContext => ({
  chef: null,
  sites: [{ siteId: NORD, name: 'Poulailler Nord', timeZone: 'Africa/Dakar', today: '2026-11-09', primaryCaretakerId: null, campaigns: [{ campaignId: BANDE, placementDay: '2026-10-12', campaignDay: 28, liveCount: 980, journal: [], deliveries: [], weighingRequests: [], strain: 'Cobb500' }] }],
});
const pesees = (fields: Partial<WeighingsView> = {}): WeighingsView => ({
  campaignId: BANDE,
  siteId: NORD,
  strain: 'Cobb500',
  openRequests: [],
  curve: [{ weighingId: uuid(201), campaignDay: 14, average: 600 }],
  toValidate: [{ weighingId: PESEE, weighingRequestId: DEMANDE, businessDate: '2026-11-09', campaignDay: 28, authorName: 'Ousmane', weights: [1820, 1905, 1760, 1880, 1850], photos: PHOTOS, average: 1843 }],
  ...fields,
});

describe('Les pesées, au bureau', () => {
  let http: HttpTestingController;

  const ouvre = async (url: string, view: WeighingsView = pesees()) => {
    const voice = provideHeardVoice([]);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: 'admin', children: adminRoutes }]),
        { provide: CLOCK, useValue: { now: () => NOW } },
        { provide: OFFICE_QUEUE, useFactory: () => OfficeQueue.open(new IDBFactory()) },
        ...voice.providers,
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    const refresh = async () => {
      await settle();
      http.match('/api/v1/caretaker/context').forEach((request) => request.flush(contexte()));
      http.match(`/api/v1/campaigns/${BANDE}/weighings`).forEach((request) => request.flush(view));
      http.match((request) => request.url.startsWith('/api/v1/media/')).forEach((request) => request.flush(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' })));
      harness.detectChanges();
      await harness.fixture.whenStable();
      harness.detectChanges();
    };
    await refresh();
    await refresh();
    const element = () => harness.routeNativeElement?.closest('app-office-shell') as HTMLElement;
    const all = (selector: string) => Array.from(element().querySelectorAll<HTMLElement>(selector));
    const tap = async (selector: string) => {
      const target = element().querySelector<HTMLElement>(selector);
      if (target === null) throw new Error(`Nothing to tap: ${selector}`);
      target.click();
      await refresh();
    };
    const type = async (selector: string, value: string) => {
      const field = element().querySelector<HTMLInputElement>(selector);
      if (field === null) throw new Error(`No field: ${selector}`);
      field.value = value;
      field.dispatchEvent(new Event('input'));
      await refresh();
    };
    const sent = (url: string) => {
      let found: TestRequest | undefined;
      return vi
        .waitFor(async () => {
          await refresh();
          found = http.match((request) => request.method === 'POST' && request.url === url)[0] ?? found;
          expect(found).toBeDefined();
        })
        .then(() => found as TestRequest);
    };
    return { element, all, tap, type, sent, refresh };
  };
  const text = (node: Element | null | undefined) => node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  afterEach(() => vi.restoreAllMocks());

  beforeEach(() => {
    let shown = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:photo-${(shown += 1)}`);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    localStorage.clear();
    localStorage.setItem('yaar.session', JSON.stringify({ token, expiresAt: '2099-01-01T00:00:00.000Z', role: 'admin', account: { name: 'Bassirou', avatar: 'baobab', language: 'fr' } }));
  });

  describe('demander', () => {
    it('les lots mènent aux pesées', async () => {
      const { tap } = await ouvre('/admin/lots');

      await tap('a.weighings');
      expect(TestBed.inject(Router).url).toBe('/admin/lots/pesees');
    });

    it('« Demander une pesée » pour aujourd’hui ou demain : la demande part au serveur, avec un identifiant fait ici', async () => {
      const { tap, sent } = await ouvre('/admin/lots/pesees');

      await tap('.when .tomorrow input');
      await tap('.ask');

      const request = await sent('/api/v1/weighing-requests');
      expect(request.request.body).toEqual({ id: expect.stringMatching(UUID), campaignId: BANDE, requestedFor: '2026-11-10' });
    });

    it('une demande pas encore pesée se voit : « demandée pour le 10/11/2026 »', async () => {
      const { all } = await ouvre('/admin/lots/pesees', pesees({ openRequests: [{ weighingRequestId: uuid(71), requestedFor: '2026-11-10' }] }));

      expect(all('.open-request').map(text)).toEqual(['Pesée demandée pour le 10/11/2026, pas encore faite']);
    });
  });

  describe('valider', () => {
    it('chaque pesée à valider : qui, quand, le jour J, ses cinq poids, la moyenne et la cible de la souche', async () => {
      const { all, element } = await ouvre('/admin/lots/pesees');

      expect(all('.to-validate .who').map(text)).toEqual(['Ousmane · 09/11/2026 · Jour 28']);
      expect(all('.to-validate input').map((field) => (field as HTMLInputElement).value)).toEqual(['1820', '1905', '1760', '1880', '1850']);
      expect(text(element().querySelector('.to-validate .average'))).toBe(`Moyenne 1 843 g · cible ${milliers(CIBLE_J28)} g`);
    });

    it('la photo prime : chaque photo de la balance s’affiche au-dessus de son poids, lue au serveur avec la session de l’admin (T.6)', async () => {
      const { all, refresh } = await ouvre('/admin/lots/pesees');

      await vi.waitFor(async () => {
        await refresh();
        expect(all('.to-validate .weight img.balance').map((img) => img.getAttribute('src'))).toEqual(['blob:photo-1', 'blob:photo-2', 'blob:photo-3', 'blob:photo-4', 'blob:photo-5']);
      });
      expect(all('.to-validate .weight img.balance').map((img) => img.getAttribute('alt'))).toEqual([1, 2, 3, 4, 5].map((rank) => `La balance du poulet ${rank}`));
    });

    it('une pesée sans photo le dit, à la place de chaque photo', async () => {
      const sansPhoto = pesees();
      const { all } = await ouvre('/admin/lots/pesees', { ...sansPhoto, toValidate: sansPhoto.toValidate.map((one) => ({ ...one, photos: null })) });

      expect(all('.to-validate .weight .no-photo').map((node) => node.textContent?.trim())).toEqual(['pas de photo', 'pas de photo', 'pas de photo', 'pas de photo', 'pas de photo']);
    });

    it('l’admin corrige un poids au clavier : la moyenne suit en direct — (1 820 + 1 905 + 1 670 + 1 880 + 1 850) ÷ 5 = 1 825 g', async () => {
      const { type, element } = await ouvre('/admin/lots/pesees');

      await type('.to-validate input[data-rank="3"]', '1670');

      expect(text(element().querySelector('.to-validate .average'))).toContain('Moyenne 1 825 g');
    });

    it('valider sans rien changer écrit la seule validation, au jour de la pesée, dans son poulailler', async () => {
      const { tap, sent } = await ouvre('/admin/lots/pesees');

      await tap('.to-validate .validate');

      const request = await sent('/api/v1/journal/events');
      expect(request.request.body).toEqual({
        events: [{ id: expect.stringMatching(UUID), siteId: NORD, campaignId: BANDE, businessDate: '2026-11-09', recordedAt: NOW.toISOString(), fact: { type: 'WeighingValidated', weighingId: PESEE } }],
      });
    });

    it('valider après une correction écrit d’abord la contre-déclaration — le poids d’origine reste au journal, les photos sont gardées —, puis la validation', async () => {
      const { tap, type, sent } = await ouvre('/admin/lots/pesees');
      await type('.to-validate input[data-rank="3"]', '1670');

      await tap('.to-validate .validate');

      const request = await sent('/api/v1/journal/events');
      const [correction, validation] = (request.request.body as { events: Record<string, unknown>[] }).events;
      expect(correction).toEqual({ id: expect.stringMatching(UUID), siteId: NORD, campaignId: BANDE, businessDate: '2026-11-09', recordedAt: NOW.toISOString(), corrects: PESEE, fact: { type: 'Weighing', weighingRequestId: DEMANDE, weights: [1820, 1905, 1670, 1880, 1850], photos: PHOTOS } });
      expect(validation).toEqual(expect.objectContaining({ fact: { type: 'WeighingValidated', weighingId: PESEE } }));
    });

    it(`un poids hors des bornes de la souche (à J28 : de ${weightBounds(STRAINS[0]!, 28).min} à ${weightBounds(STRAINS[0]!, 28).max} g) s’affiche en rouge, à l’ouverture comme pendant la frappe ; il se valide quand même`, async () => {
      const { type, all, element } = await ouvre('/admin/lots/pesees', pesees({ toValidate: [{ ...pesees().toValidate[0]!, weights: [1820, 22221, 1760, 1880, 1850] }] }));
      const rouges = () => all('.to-validate .weight').map((weight) => weight.classList.contains('out'));

      expect(rouges()).toEqual([false, true, false, false, false]);
      expect(text(all('.to-validate .weight')[1])).toContain('hors des bornes');
      await type('.to-validate input[data-rank="4"]', '18');
      expect(rouges()).toEqual([false, true, false, true, false]);
      await type('.to-validate input[data-rank="2"]', '1905');
      expect(rouges()).toEqual([false, false, false, true, false]);
      expect(element().querySelector<HTMLButtonElement>('.to-validate .validate')?.disabled).toBe(false);
    });

    it('un poids vide ou nul empêche de valider', async () => {
      const { type, element } = await ouvre('/admin/lots/pesees');

      await type('.to-validate input[data-rank="2"]', '');

      expect(element().querySelector<HTMLButtonElement>('.to-validate .validate')?.disabled).toBe(true);
    });

    it('un refus du serveur se dit, et la pesée reste à valider', async () => {
      const { tap, sent, element, refresh } = await ouvre('/admin/lots/pesees');
      await tap('.to-validate .validate');

      const request = await sent('/api/v1/journal/events');
      request.flush({ outcomes: [{ index: 0, id: 'x', status: 'Refused', refusal: { kind: 'WeighingAlreadyValidated' } }] });
      await refresh();

      expect(text(element().querySelector('.to-validate [role=alert]'))).toBe('Pesée déjà validée.');
    });
  });

  it('la courbe réelle : chaque pesée validée, au jour J, avec sa moyenne et la cible de la souche', async () => {
    const { all } = await ouvre('/admin/lots/pesees');

    expect(all('.curve li').map(text)).toEqual([`Jour 14 600 g cible ${milliers(CIBLE_J14)} g`]);
  });
});
