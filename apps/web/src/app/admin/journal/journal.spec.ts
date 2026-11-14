import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { IDBFactory } from 'fake-indexeddb';
import type { CampaignDayView, CampaignJournalView, CaretakerContext, JournalBatchRequest, OfficeJournalLine } from '@contracts';
import { provideHeardVoice } from '../../core/audio/testing';
import { CLOCK } from '../../core/clock';
import { OfficeQueue } from '../../core/outbox/office-queue';
import { Outbox } from '../../core/outbox/outbox';
import { OUTBOX } from '../../core/sync/journal-sync';
import { adminRoutes } from '../admin.routes';
import { OFFICE_QUEUE } from '../office-sync';

// Spec: backlog O.7 — le journal de la bande, au bureau (demande du fondateur du 2026-11-13) ;
// CLAUDE.md §4 règle 1 (rien ne s'efface : corriger écrit une contre-déclaration, annuler une
// annulation définitive) et règle 3 (une déclaration à la place du gardien part de la file d'attente,
// hors-ligne aussi ; corriger et annuler demandent le réseau).

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT = uuid(10);
const LE_GERANT = uuid(54);
const OUSMANE = uuid(51);
const NORD = uuid(3);
const BANDE = uuid(4);
const token = `e30.${btoa(JSON.stringify({ sub: LE_GERANT, tenant: TENANT })).replace(/=+$/, '')}.c2ln`;
const NOW = new Date('2026-11-12T10:00:00.000Z');
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

const contexte = (): CaretakerContext => ({
  chef: null,
  sites: [{ siteId: NORD, name: 'Poulailler Nord', timeZone: 'Africa/Dakar', today: '2026-11-12', primaryCaretakerId: null, campaigns: [{ campaignId: BANDE, placementDay: '2026-10-12', campaignDay: 31, liveCount: 938, journal: [], deliveries: [], weighingRequests: [], strain: 'Cobb500' }] }],
});
const par = (id: string, name: string, recordedAt: string) => ({ author: { id, name }, recordedAt });
// The server's test (campaign-journal.integration.spec.ts): 3 deaths corrected to 2, 2 bags taken back, 1 bag written by the chef for the 3rd.
const lignes = (): OfficeJournalLine[] => [
  { id: uuid(101), siteId: NORD, businessDate: '2026-11-12', ...par(OUSMANE, 'Ousmane', '2026-11-12T08:00:00.000Z'), declared: { type: 'Death', quantity: 3 }, fact: { type: 'Death', quantity: 2 }, correction: par(LE_GERANT, 'Le gérant', '2026-11-12T09:00:00.000Z'), retraction: null },
  { id: uuid(102), siteId: NORD, businessDate: '2026-11-11', ...par(OUSMANE, 'Ousmane', '2026-11-11T18:00:00.000Z'), declared: { type: 'BagOpened', quantity: 2 }, fact: null, correction: null, retraction: par(LE_GERANT, 'Le gérant', '2026-11-12T09:30:00.000Z') },
  { id: uuid(105), siteId: NORD, businessDate: '2026-11-03', ...par(LE_GERANT, 'Le gérant', '2026-11-12T09:40:00.000Z'), declared: { type: 'BagOpened', quantity: 1 }, fact: { type: 'BagOpened', quantity: 1 }, correction: null, retraction: null },
];
// The 32 days of the flock, J0 the 12th of October to J31 the 12th of November, as the server sums them up:
// 2 deaths on J31, nothing lost on J29, 1 bag on J22, nothing said on the other days.
const jours = (): CampaignDayView[] =>
  Array.from({ length: 32 }, (_, campaignDay) => {
    const day = new Date(Date.UTC(2026, 9, 12 + campaignDay)).toISOString().slice(0, 10);
    const mortality: CampaignDayView['mortality'] = campaignDay === 31 ? { kind: 'DeathsDeclared', deaths: 2 } : campaignDay === 29 ? { kind: 'NoLossDeclared' } : { kind: 'NotDeclared' };
    return { day, campaignDay, mortality, bagsOpened: campaignDay === 22 ? 1 : 0 };
  });
const journal = (fields: Partial<CampaignJournalView> = {}): CampaignJournalView => ({ campaignId: BANDE, siteId: NORD, placementDay: '2026-10-12', today: '2026-11-12', closed: false, lines: lignes(), days: jours(), ...fields });

describe('Le journal de la bande, au bureau', () => {
  let http: HttpTestingController;
  let outbox: Outbox;

  const ouvre = async (view: CampaignJournalView = journal()) => {
    const voice = provideHeardVoice([]);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: 'admin', children: adminRoutes }]),
        { provide: CLOCK, useValue: { now: () => NOW } },
        { provide: OFFICE_QUEUE, useFactory: () => OfficeQueue.open(new IDBFactory()) },
        { provide: OUTBOX, useValue: Promise.resolve(outbox) },
        ...voice.providers,
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/admin/lots/journal');
    const reads: TestRequest[] = [];
    const refresh = async () => {
      await settle();
      http.match('/api/v1/caretaker/context').forEach((request) => request.flush(contexte()));
      http.match(`/api/v1/campaigns/${BANDE}/journal`).forEach((request) => {
        reads.push(request);
        request.flush(view);
      });
      harness.detectChanges();
      await harness.fixture.whenStable();
      harness.detectChanges();
    };
    await refresh();
    await refresh();
    const element = () => harness.routeNativeElement?.closest('app-office-shell') as HTMLElement;
    const tap = async (selector: string) => {
      const target = element().querySelector<HTMLElement>(selector);
      if (target === null) throw new Error(`Nothing to tap: ${selector}`);
      target.click();
      await refresh();
    };
    const type = async (selector: string, value: string) => {
      const input = element().querySelector<HTMLInputElement>(selector);
      if (input === null) throw new Error(`No field: ${selector}`);
      input.value = value;
      input.dispatchEvent(new Event('input'));
      await refresh();
    };
    const sent = async () => {
      let found: TestRequest | undefined;
      await vi.waitFor(async () => {
        await refresh();
        found = http.match((request) => request.method === 'POST' && request.url === '/api/v1/journal/events')[0];
        expect(found).toBeDefined();
      });
      return found as TestRequest;
    };
    return { element, tap, type, sent, refresh, reads };
  };
  const text = (node: Element | null | undefined) => node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const ligne = (id: string) => `.line[data-id="${id}"]`;

  beforeEach(async () => {
    localStorage.clear();
    localStorage.setItem('yaar.session', JSON.stringify({ token, expiresAt: '2099-01-01T00:00:00.000Z', role: 'admin', account: { name: 'Le gérant', avatar: 'baobab', language: 'fr' } }));
    outbox = await Outbox.open(new IDBFactory());
  });

  it('les lots mènent au journal', async () => {
    const { tap, refresh } = await ouvre();
    await TestBed.inject(Router).navigateByUrl('/admin/lots');
    await refresh();
    await tap('a.journal');
    expect(TestBed.inject(Router).url).toBe('/admin/lots/journal');
  });

  it('chaque déclaration, le dernier jour d’abord : qui, quoi ; une correction garde l’ancienne valeur lisible, une annulation reste écrite', async () => {
    const { element } = await ouvre();

    expect(Array.from(element().querySelectorAll('.day h2')).map(text)).toEqual(['jeudi 12 novembre · J31', 'mercredi 11 novembre · J30', 'mardi 3 novembre · J22']);
    expect(text(element().querySelector(`${ligne(uuid(101))} .what`))).toBe('3 → 2 morts');
    expect(text(element().querySelector(`${ligne(uuid(101))} .who`))).toBe('par Ousmane · corrigé par Le gérant');
    expect(text(element().querySelector(`${ligne(uuid(102))} .what`))).toBe('2 sacs ouverts');
    expect(text(element().querySelector(`${ligne(uuid(102))} .who`))).toBe('par Ousmane · annulé par Le gérant');
    expect(element().querySelector(ligne(uuid(102)))?.classList).toContain('retracted');
    expect(element().querySelector(`${ligne(uuid(102))} button`)).toBeNull();
    expect(text(element().querySelector(`${ligne(uuid(105))} .who`))).toBe('par Le gérant');
  });

  it('« Corriger » écrit une contre-déclaration, en ligne : le jour de la déclaration — pas aujourd’hui —, nouvelle quantité ; puis le journal se relit', async () => {
    const { tap, type, sent, reads, refresh } = await ouvre();
    await tap(`${ligne(uuid(105))} button.correct`);
    await type(`${ligne(uuid(105))} input[name=quantity]`, '2');
    await tap(`${ligne(uuid(105))} button.write`);

    const request = await sent();
    expect((request.request.body as JournalBatchRequest).events).toEqual([
      { id: expect.stringMatching(/^[0-9a-f-]{36}$/), siteId: NORD, campaignId: BANDE, businessDate: '2026-11-03', recordedAt: NOW.toISOString(), corrects: uuid(105), fact: { type: 'BagOpened', quantity: 2 } },
    ]);
    const before = reads.length;
    request.flush({ outcomes: [{ index: 0, id: 'x', status: 'Accepted' }] });
    await vi.waitFor(async () => {
      await refresh();
      expect(reads.length).toBeGreaterThan(before);
    });
  });

  it('« Annuler » demande une confirmation sur la ligne — rien ne part avant —, puis écrit une annulation définitive', async () => {
    const { tap, sent, element } = await ouvre();
    await tap(`${ligne(uuid(105))} button.retract`);
    expect(text(element().querySelector(`${ligne(uuid(105))} .confirm`))).toContain('définitif');
    expect(http.match((request) => request.method === 'POST')).toEqual([]);

    await tap(`${ligne(uuid(105))} button.confirm-retract`);
    const request = await sent();
    expect((request.request.body as JournalBatchRequest).events).toEqual([
      { id: expect.stringMatching(/^[0-9a-f-]{36}$/), siteId: NORD, campaignId: BANDE, businessDate: '2026-11-03', recordedAt: NOW.toISOString(), retracts: uuid(105) },
    ]);
  });

  it('un refus du serveur se dit sur la ligne, et sans réseau rien n’est gardé : on réessaie', async () => {
    const { tap, type, sent, element } = await ouvre();
    await tap(`${ligne(uuid(101))} button.correct`);
    await type(`${ligne(uuid(101))} input[name=quantity]`, '1');
    await tap(`${ligne(uuid(101))} button.write`);
    (await sent()).flush({ outcomes: [{ index: 0, status: 'Refused', refusal: { kind: 'CampaignClosed' } }] });
    await vi.waitFor(() => expect(text(element().querySelector(`${ligne(uuid(101))} .refusal`))).toContain('close'));

    await tap(`${ligne(uuid(101))} button.write`);
    (await sent()).error(new ProgressEvent('error'));
    await vi.waitFor(() => expect(text(element().querySelector(`${ligne(uuid(101))} .refusal`))).toContain('réseau'));
    expect(await outbox.entriesOf(BANDE)).toEqual([]);
  });

  it('« Ajouter » écrit une déclaration à la place du gardien, à n’importe quel jour de la bande : elle part de la file d’attente, au nom de l’admin', async () => {
    const { tap, type, element } = await ouvre();
    await tap('button.add');
    const jour = element().querySelector<HTMLInputElement>('input[name=businessDate]');
    expect([jour?.min, jour?.max, jour?.value]).toEqual(['2026-10-12', '2026-11-12', '2026-11-12']);

    await type('input[name=businessDate]', '2026-11-03');
    await tap('.kinds input[value=BagOpened]');
    await type('.add-form input[name=quantity]', '1');
    await tap('.add-form button.write');

    await vi.waitFor(async () => {
      const [entry] = await outbox.entriesOf(BANDE);
      expect(entry).toMatchObject({ authorId: LE_GERANT, payload: { siteId: NORD, campaignId: BANDE, businessDate: '2026-11-03', recordedAt: NOW.toISOString(), fact: { type: 'BagOpened', quantity: 1 } } });
    });
  });

  it('« Rien perdu » se déclare sans quantité ; une perte (manquants, dons, vols) avec la sienne', async () => {
    const { tap, type, element } = await ouvre();
    await tap('button.add');
    await tap('.kinds input[value=NoLoss]');
    expect(element().querySelector('.add-form input[name=quantity]')).toBeNull();
    await tap('.kinds input[value=Theft]');
    await type('.add-form input[name=quantity]', '4');
    await tap('.add-form button.write');

    await vi.waitFor(async () => expect((await outbox.entriesOf(BANDE))[0]?.payload).toMatchObject({ fact: { type: 'Loss', lossType: 'Theft', quantity: 4 } }));
  });

  // Spec: backlog R.6 — le bon de livraison photographié s'ouvre depuis le journal
  it('une réception dont le bon est photographié l’ouvre d’un tap ; sans papier, rien à ouvrir', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:bon');
    const BON = 'b'.repeat(64);
    const livraison = (id: string, deliveryNote: { kind: 'Photographed'; media: string } | { kind: 'NoPaper' }): OfficeJournalLine => ({
      id, siteId: NORD, businessDate: '2026-11-12', ...par(OUSMANE, 'Ousmane', '2026-11-12T07:00:00.000Z'),
      declared: { type: 'Delivery', orderLineId: uuid(21), receivedQuantity: 20, deliveryNote }, fact: { type: 'Delivery', orderLineId: uuid(21), receivedQuantity: 20, deliveryNote }, correction: null, retraction: null, delivery: { name: 'Aliment démarrage' },
    });
    const { tap, element, refresh } = await ouvre(journal({ lines: [livraison(uuid(110), { kind: 'Photographed', media: BON }), livraison(uuid(111), { kind: 'NoPaper' })] }));

    expect(element().querySelector(`${ligne(uuid(111))} app-photos .photo`)).toBeNull();
    await tap(`${ligne(uuid(110))} app-photos .photo`);
    http.expectOne(`/api/v1/media/${BON}`).flush(new Blob([new Uint8Array([1])], { type: 'image/jpeg' }));
    await vi.waitFor(async () => {
      await refresh();
      expect(element().querySelector<HTMLImageElement>('.photo-viewer img')?.getAttribute('src')).toBe('blob:bon');
    });
    vi.restoreAllMocks();
  });

  it('une bande close se lit, ne s’écrit plus : ni ajout, ni correction, ni annulation', async () => {
    const { element } = await ouvre(journal({ closed: true }));
    expect(element().querySelector('button.add')).toBeNull();
    expect(element().querySelector('button.correct')).toBeNull();
    expect(element().querySelector('button.retract')).toBeNull();
    expect(element().querySelectorAll('.line')).toHaveLength(3);
  });

  // Spec: backlog O.8 — le calendrier de la bande (demande du fondateur du 2026-11-13 : le calendrier comme filtre, et une plage de dates)
  describe('le calendrier', () => {
    const jour = (campaignDay: number) => `.calendar .cell[data-day="J${campaignDay}"]`;
    const montrees = (element: () => HTMLElement) => Array.from(element().querySelectorAll('.line')).map((line) => line.getAttribute('data-id'));

    it('une case par jour, de J0 à aujourd’hui, rangée par semaines ; chaque jour dit son résumé par picto, couleur et mot — les trous se voient', async () => {
      const { element } = await ouvre();

      expect(element().querySelectorAll('.calendar .cell')).toHaveLength(32);
      expect(Array.from(element().querySelectorAll('.calendar .week-label')).map(text)).toEqual(['Semaine 1', 'Semaine 2', 'Semaine 3', 'Semaine 4', 'Semaine 5']);
      expect([text(element().querySelector(jour(31))), element().querySelector(jour(31))?.classList.contains('deaths')]).toEqual(['J31 2 morts', true]);
      expect([text(element().querySelector(jour(29))), element().querySelector(jour(29))?.classList.contains('no-loss')]).toEqual(['J29 rien perdu', true]);
      expect([text(element().querySelector(jour(5))), element().querySelector(jour(5))?.classList.contains('not-declared')]).toEqual(['J5 rien écrit', true]);
      expect(text(element().querySelector(jour(22)))).toBe('J22 rien écrit 1 sac');
    });

    // Décision du fondateur du 2026-11-13 : la journée n'est pas finie, son vide n'est pas encore un trou
    it('aujourd’hui sans rien d’écrit est « en cours », neutre ; il ne devient « rien écrit » qu’une fois passé', async () => {
      const sansRienAujourdhui = jours().map((cell) => (cell.campaignDay === 31 ? { ...cell, mortality: { kind: 'NotDeclared' as const } } : cell));
      const { element } = await ouvre(journal({ days: sansRienAujourdhui }));

      const aujourdhui = element().querySelector(jour(31));
      expect([text(aujourdhui), aujourdhui?.classList.contains('today'), aujourdhui?.classList.contains('not-declared')]).toEqual(['J31 en cours', true, false]);
      expect(element().querySelector(jour(30))?.classList.contains('not-declared')).toBe(true);
    });

    it('un tap sur un jour ne montre que ce jour ; « tout voir » revient à la bande entière', async () => {
      const { tap, element } = await ouvre();
      await tap(`${jour(22)} button`);

      expect(montrees(element)).toEqual([uuid(105)]);
      expect(text(element().querySelector('.filter'))).toBe('J22 tout voir');
      await tap('.filter button');
      expect(montrees(element)).toHaveLength(3);
    });

    it('un second tap sur un autre jour choisit la plage entre les deux, dans un sens ou dans l’autre', async () => {
      const { tap, element } = await ouvre();
      await tap(`${jour(31)} button`);
      await tap(`${jour(30)} button`);

      expect(montrees(element)).toEqual([uuid(101), uuid(102)]);
      expect(text(element().querySelector('.filter'))).toBe('du J30 au J31 tout voir');
    });

    it('un tap sur « Semaine 4 » choisit ses sept jours, J21 à J27', async () => {
      const { tap, element } = await ouvre();
      await tap('.calendar .week:nth-child(4) .week-label');

      expect(montrees(element)).toEqual([uuid(105)]);
      expect(text(element().querySelector('.filter'))).toBe('du J21 au J27 tout voir');
    });

    it('« Ajouter une déclaration » prend le jour choisi', async () => {
      const { tap, element } = await ouvre();
      await tap(`${jour(5)} button`);
      await tap('button.add');

      expect(element().querySelector<HTMLInputElement>('input[name=businessDate]')?.value).toBe('2026-10-17');
    });
  });
});

