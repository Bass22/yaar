import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { IDBFactory } from 'fake-indexeddb';
import type { CaretakerContext, CounterpartyView, SalesView } from '@contracts';
import { provideHeardVoice } from '../../core/audio/testing';
import { CLOCK } from '../../core/clock';
import { OfficeQueue } from '../../core/outbox/office-queue';
import { adminRoutes } from '../admin.routes';
import { OFFICE_QUEUE } from '../office-sync';

// Spec: backlog W.3 — saisir une vente ; cahier des charges « Les ventes » (décisions du 2026-11-12 :
// par tête ou au kilo, payé en tout, en partie ou à crédit ; marge = encaissé − engagé) ; le même
// geste que la dépense (P.4). L'écran n'additionne rien : l'argent des ventes vient du serveur.

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT = uuid(10);
const LE_GERANT = uuid(54);
const NORD = uuid(3);
const BANDE = uuid(4);
const MOUSSA = uuid(33);
const SEDIMA = uuid(31);
const token = `e30.${btoa(JSON.stringify({ sub: LE_GERANT, tenant: TENANT })).replace(/=+$/, '')}.c2ln`;
// Wednesday November 25th, 2026, 08:00 in Dakar.
const NOW = new Date('2026-11-25T08:00:00.000Z');
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const contexte = (): CaretakerContext => ({
  chef: null,
  sites: [{ siteId: NORD, name: 'Poulailler Nord', timeZone: 'Africa/Dakar', today: '2026-11-25', primaryCaretakerId: null, campaigns: [{ campaignId: BANDE, placementDay: '2026-10-12', campaignDay: 44, liveCount: 1045, journal: [], deliveries: [], weighingRequests: [], strain: 'Cobb500' }] }],
});
// The farm's « Frais financiers » type: what a Wave or Orange Money fee is written as (P.8).
const FRAIS = uuid(45);
const tiers = (): CounterpartyView[] => [
  { id: MOUSSA, kind: 'Customer', name: 'Moussa', face: 'hen', archived: false },
  { id: SEDIMA, kind: 'Supplier', name: 'Sedima', face: 'closed-bag', archived: false },
  { id: uuid(34), kind: 'Customer', name: 'Ancien', face: 'truck', archived: true },
];
const aucuneVente = (): SalesView => ({ campaignId: BANDE, currency: 'XOF', birdsSold: 0, revenue: 0, cashedIn: 0, margin: null, averagePrice: null, remaining: 1045, sales: [] });
// 200 birds at 2 750 F to Moussa, 200 000 F received; 180 birds by weight on credit.
const desVentes = (): SalesView => ({
  campaignId: BANDE,
  currency: 'XOF',
  birdsSold: 380,
  revenue: 1_092_760,
  cashedIn: 200_000,
  margin: -350_000,
  averagePrice: 2_876,
  remaining: 665,
  sales: [
    { id: uuid(302), buyerId: MOUSSA, soldOn: '2026-11-25', birds: 180, pricing: { kind: 'PerKilo', grams: 452_300, pricePerKilo: 1_200 }, amount: 542_760, received: 0, receipts: [] },
    { id: uuid(301), buyerId: MOUSSA, soldOn: '2026-11-24', birds: 200, pricing: { kind: 'PerBird', unitPrice: 2_750 }, amount: 550_000, received: 200_000, receipts: [{ id: uuid(1301), paidOn: '2026-11-24', amount: 200_000, method: 'Cash' }] },
  ],
});
const RECORDED = ['sale-to-whom', 'sale-how-many', 'sale-paid-how-much', 'sale-birds', 'sale-all-paid', 'sale-still-owes', 'sales-margin', 'sales-margin-negative', 'sales-none-yet', 'money-amount', 'money-francs', 'confirm', 'written-thanks', 'number-and', 'number-1000', ...Array.from({ length: 101 }, (_, value) => `number-${value}`), ...Array.from({ length: 10 }, (_, value) => `number-${value * 100}`)];

describe('Les ventes, au bureau', () => {
  let http: HttpTestingController;
  let heard: string[][];

  const ouvre = async (url: string, sales: SalesView = desVentes()) => {
    const voice = provideHeardVoice(RECORDED);
    heard = voice.heard;
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
      http.match('/api/v1/orders').forEach((request) => request.flush([]));
      http.match('/api/v1/counterparties').forEach((request) => request.flush(tiers()));
      http.match('/api/v1/cost-types').forEach((request) => request.flush([{ id: FRAIS, category: 'FinancialCharges', name: 'Frais financiers', behaviour: 'Fixed', orderable: false, archived: false }]));
      http.match('/api/v1/reference-data').forEach((request) => request.flush({ currency: 'XOF', costCategories: [], lossTypes: [], strains: [] }));
      http.match(`/api/v1/campaigns/${BANDE}/sales`).forEach((request) => request.flush(sales));
      harness.detectChanges();
      await harness.fixture.whenStable();
      harness.detectChanges();
    };
    await refresh();
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

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('yaar.session', JSON.stringify({ token, expiresAt: '2099-01-01T00:00:00.000Z', role: 'admin', account: { name: 'Bassirou', avatar: 'baobab', language: 'fr' } }));
  });

  describe('la liste', () => {
    it('les lots mènent aux ventes', async () => {
      const { tap } = await ouvre('/admin/lots');

      await tap('a.sales');
      expect(TestBed.inject(Router).url).toBe('/admin/lots/ventes');
    });

    it('avant la première vente : la marge et le prix moyen sont « pas encore », jamais zéro ; le reste à vendre = les vivants', async () => {
      const { all } = await ouvre('/admin/lots/ventes', aucuneVente());

      expect(all('.figure').map(text)).toEqual([expect.stringContaining('Marge en direct pas encore'), 'Ventes 0 F', 'Encaissé 0 F', 'Prix moyen pas encore', 'Reste à vendre 1045 poulets']);
    });

    it('la marge en direct, signée et en rouge sous zéro ; le prix moyen ; le reste à vendre — venus du serveur', async () => {
      const { all, element } = await ouvre('/admin/lots/ventes');

      expect(all('.figure').map(text)).toEqual([expect.stringContaining('Marge en direct − 350 000 F'), 'Ventes 1 092 760 F', 'Encaissé 200 000 F', 'Prix moyen 2 876 F le poulet', 'Reste à vendre 665 poulets']);
      expect(element().querySelector('.figure.margin')?.classList).toContain('minus');
    });

    it('chaque vente : l’acheteur, le jour, les poulets, le prix par tête ou au kilo, ce qu’il doit encore', async () => {
      const { all } = await ouvre('/admin/lots/ventes');

      expect(all('.sale').map(text)).toEqual([
        'Moussa 25/11/2026 · 180 poulets · 452,3 kg à 1 200 F 542 760 F doit encore 542 760 F',
        'Moussa 24/11/2026 · 200 poulets · 2 750 F le poulet 550 000 F doit encore 350 000 F',
      ]);
    });
  });

  describe('le geste', () => {
    it('à qui : une tuile par client en usage — ni fournisseur ni archivé — ; la voix pose la question', async () => {
      const { all } = await ouvre('/admin/lots/vente');

      expect(all('.tile.buyer').map(text)).toEqual(['Moussa']);
      await vi.waitFor(() => expect(heard.flat()).toContain('fr/sale-to-whom'));
    });

    it('par tête, payé en partie : 200 × 2 750 = 550 000 F posés en billets ; 200 000 F en espèces ; la relecture dit ce qu’il doit encore ; Oui garde la vente puis revient', async () => {
      const { tap, type, element, all, sent } = await ouvre('/admin/lots/vente');

      await tap('.tile.buyer');
      await type('input[name=birds]', '200');
      await type('input[name=unitPrice]', '2750');
      expect(text(element().querySelector('.amount'))).toBe('550 000 F');
      expect(all('app-banknotes .bundle')).toHaveLength(5);
      await tap('.next');
      await tap('.choices .choice:nth-child(2) input');
      await type('input[name=received]', '200000');
      await tap('.method-cash input');
      await tap('.next');

      expect(text(element().querySelector('.card'))).toMatch(/Moussa.*200 poulets.*550 000 F.*payé 200 000 F, doit encore 350 000 F/);
      await vi.waitFor(() => expect(heard.flat()).toEqual(expect.arrayContaining(['fr/sale-birds', 'fr/sale-still-owes'])));
      await tap('.confirm');
      const request = await sent('/api/v1/sales');
      expect(request.request.body).toEqual({
        id: expect.stringMatching(UUID),
        campaignId: BANDE,
        buyerId: MOUSSA,
        soldOn: '2026-11-25',
        birds: 200,
        pricing: { kind: 'PerBird', unitPrice: 2_750 },
        receivedNow: { id: expect.stringMatching(UUID), amount: 200_000, method: 'Cash' },
      });
      await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe(`/admin/lots/ventes?lot=${BANDE}`));
    });

    it('payé tout de suite par Orange Money, frais de ton côté : la relecture les dit ; la vente garde ce que l’acheteur a payé, puis les frais partent comme une dépense payée du lot', async () => {
      const { tap, type, element, sent } = await ouvre('/admin/lots/vente');

      await tap('.tile.buyer');
      await type('input[name=birds]', '200');
      await type('input[name=unitPrice]', '2750');
      await tap('.next');
      await tap('.method-orange input');
      await type('input[name=fee]', '5500');
      await tap('.next');

      expect(text(element().querySelector('.card .fee-words'))).toBe('frais Orange Money payés par toi : 5 500 F');
      await tap('.confirm');
      const sale = await sent('/api/v1/sales');
      expect(sale.request.body).toEqual(expect.objectContaining({ receivedNow: { id: expect.stringMatching(UUID), amount: 550_000, method: 'OrangeMoney' } }));
      sale.flush(null, { status: 201, statusText: 'Created' });
      expect((await sent('/api/v1/costs')).request.body).toEqual(expect.objectContaining({ campaignId: BANDE, costTypeId: FRAIS, spentOn: '2026-11-25', amount: 5_500, note: 'Frais Orange Money — vente Moussa' }));
    });

    it('des frais qui ne sont pas des francs entiers arrêtent avant la relecture ; à crédit, aucune case', async () => {
      const { tap, type, element } = await ouvre('/admin/lots/vente');
      await tap('.tile.buyer');
      await type('input[name=birds]', '200');
      await type('input[name=unitPrice]', '2750');
      await tap('.next');
      await tap('.method-wave input');
      await type('input[name=fee]', '1.5');
      await tap('.next');

      expect(text(element().querySelector('.refusal'))).toContain('Les frais : des francs entiers');
      await tap('.choices .choice:nth-child(3) input');
      expect(element().querySelector('input[name=fee]')).toBeNull();
    });

    it('des frais tapés, puis « à crédit » : rien n’est reçu, donc aucun frais dans la relecture', async () => {
      const { tap, type, element } = await ouvre('/admin/lots/vente');
      await tap('.tile.buyer');
      await type('input[name=birds]', '200');
      await type('input[name=unitPrice]', '2750');
      await tap('.next');
      await tap('.method-wave input');
      await type('input[name=fee]', '5500');
      await tap('.choices .choice:nth-child(3) input');
      await tap('.next');

      expect(text(element().querySelector('.card .how'))).toBe('à crédit : Moussa doit tout');
      expect(element().querySelector('.card .fee-words')).toBeNull();
    });

    it('au kilo, à crédit : le poids pesé × le prix du kilo — 452,3 kg × 1 200 = 542 760 F — ; rien reçu, l’acheteur doit tout', async () => {
      const { tap, type, element, sent } = await ouvre('/admin/lots/vente');

      await tap('.tile.buyer');
      await type('input[name=birds]', '180');
      await tap('.choices .choice:nth-child(2) input');
      await type('input[name=kilos]', '452.3');
      await type('input[name=pricePerKilo]', '1200');
      expect(text(element().querySelector('.amount'))).toBe('542 760 F');
      await tap('.next');
      // A way of paying chosen, then « nothing, on credit »: nothing is received.
      await tap('.choices .choice:nth-child(2) input');
      await tap('.method-wave input');
      await tap('.choices .choice:nth-child(3) input');
      await tap('.next');
      expect(text(element().querySelector('.card .how'))).toBe('à crédit : Moussa doit tout');
      await tap('.confirm');

      expect((await sent('/api/v1/sales')).request.body).toMatchObject({ birds: 180, pricing: { kind: 'PerKilo', grams: 452_300, pricePerKilo: 1_200 }, receivedNow: null });
    });

    it('la règle du domaine refuse avant de continuer : aucun poulet ; payé sans moyen', async () => {
      const { tap, type, element } = await ouvre('/admin/lots/vente');

      await tap('.tile.buyer');
      await type('input[name=unitPrice]', '2750');
      await tap('.next');
      expect(text(element().querySelector('.refusal'))).toContain('Combien de poulets');
      await type('input[name=birds]', '10');
      await tap('.next');
      await tap('.next');
      expect(text(element().querySelector('.refusal'))).toContain('Choisis comment il a payé');
      expect(http.match((request) => request.method === 'POST')).toEqual([]);
    });
  });

  describe('encaisser plus tard', () => {
    it('la vente dit ce qu’elle vaut, ce qui est reçu et ce qui reste ; « Encaisser » propose le reste et garde l’encaissement', async () => {
      const { element, tap, sent } = await ouvre(`/admin/lots/ventes/${uuid(301)}?lot=${BANDE}`);

      expect(text(element().querySelector('.balance'))).toMatch(/Vente 550 000 F.*Reçu 200 000 F.*Il doit encore 350 000 F/);
      expect(element().querySelector<HTMLInputElement>('input[name=amount]')?.value).toBe('350000');
      await tap('.method-wave input');
      await tap('.go');

      expect((await sent(`/api/v1/sales/${uuid(301)}/receipts`)).request.body).toEqual({ id: expect.stringMatching(UUID), paidOn: '2026-11-25', amount: 350_000, method: 'Wave' });
    });

    // Spec: backlog P.8 — les frais Wave et Orange Money à la réception (décisions du 2026-11-12) :
    // tantôt l'acheteur les paie, tantôt l'élevage ; ce qu'il a payé diminue toute sa créance.
    it('encaisser par Wave avec des frais de ton côté : l’encaissement garde le montant payé par l’acheteur ; les frais partent comme une dépense payée du lot', async () => {
      const { element, tap, type, sent } = await ouvre(`/admin/lots/ventes/${uuid(301)}?lot=${BANDE}`);

      expect(element().querySelector('input[name=fee]')).toBeNull();
      await tap('.method-wave input');
      await type('input[name=fee]', '3500');
      await tap('.go');

      const receipt = await sent(`/api/v1/sales/${uuid(301)}/receipts`);
      expect(receipt.request.body).toEqual(expect.objectContaining({ amount: 350_000, method: 'Wave' }));
      receipt.flush(null, { status: 201, statusText: 'Created' });
      expect((await sent('/api/v1/costs')).request.body).toEqual(expect.objectContaining({ campaignId: BANDE, costTypeId: FRAIS, spentOn: '2026-11-25', amount: 3_500, note: 'Frais Wave — encaissement Moussa', payment: { kind: 'Paid' } }));
    });
  });
});
