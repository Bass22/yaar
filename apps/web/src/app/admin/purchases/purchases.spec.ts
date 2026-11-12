import { provideHttpClient } from '@angular/common/http';
import { IDBFactory } from 'fake-indexeddb';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { CaretakerContext, CounterpartyView, CostTypeView, DraftOrderRequest, OrderView } from '@contracts';
import { CLOCK } from '../../core/clock';
import { OfficeQueue } from '../../core/outbox/office-queue';
import { OFFICE_QUEUE } from '../office-sync';
import { adminRoutes } from '../admin.routes';

// Spec: backlog Q.5 — l'éditeur de commande ; cahier des charges « Commandes » (au bureau, en
// ligne ; un fournisseur se crée sur place : décision du 2026-11-09) ; « Un bureau pour ceux qui ne
// lisent pas » (un picto d'objet réel et le mot) ; le total de la saisie vient de domain/finance.
// Et backlog Q.9 — payer une commande ; cahier des charges « Payer une commande » (décision du 2026-11-11).

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT = uuid(10);
const LE_GERANT = uuid(54);
const NORD = uuid(3);
const BANDE = uuid(4);
const SEDIMA = uuid(31);
const TOUBA_AVICOLE = uuid(32);
const ALIMENT = uuid(41);
const POUSSINS = uuid(42);
const token = `e30.${btoa(JSON.stringify({ sub: LE_GERANT, tenant: TENANT })).replace(/=+$/, '')}.c2ln`;
// Monday October 12th, 2026, 08:00 in Dakar.
const NOW = new Date('2026-10-12T08:00:00.000Z');
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

const contexte = (): CaretakerContext => ({
  chef: null,
  sites: [{ siteId: NORD, name: 'Poulailler Nord', timeZone: 'Africa/Dakar', today: '2026-10-12', primaryCaretakerId: null, campaigns: [{ campaignId: BANDE, placementDay: '2026-10-01', campaignDay: 11, liveCount: null, journal: [], deliveries: [], weighingRequests: [], strain: 'Cobb500' }] }],
});
const tiers = (): CounterpartyView[] => [
  { id: SEDIMA, kind: 'Supplier', name: 'Sedima', face: 'closed-bag', archived: false },
  { id: TOUBA_AVICOLE, kind: 'Supplier', name: 'Touba Avicole', face: 'chick', archived: false },
  { id: uuid(33), kind: 'Supplier', name: 'Ancien fournisseur', face: 'truck', archived: true },
  { id: uuid(34), kind: 'Customer', name: 'Ramasseur', face: 'hen', archived: false },
];
// The farm's type of the « Frais financiers » category: what a Wave or Orange Money fee is written as (P.8).
const FRAIS = uuid(45);
const types = (): CostTypeView[] => [
  { id: ALIMENT, category: 'Feed', name: 'Aliment', behaviour: 'Variable', orderable: true, archived: false },
  { id: POUSSINS, category: 'Chicks', name: 'Poussins', behaviour: 'Variable', orderable: true, archived: false },
  { id: uuid(43), category: 'Labour', name: 'Salaire du gardien', behaviour: 'Fixed', orderable: false, archived: false },
  { id: uuid(44), category: 'Processing', name: 'Déplumage', behaviour: 'Variable', orderable: false, archived: true },
  { id: FRAIS, category: 'FinancialCharges', name: 'Frais financiers', behaviour: 'Fixed', orderable: false, archived: false },
];
const uneCommande = (fields: Partial<OrderView> = {}): OrderView => ({
  id: uuid(1),
  supplierId: SEDIMA,
  campaignId: BANDE,
  orderDay: '2026-10-12',
  reference: null,
  currency: 'XOF',
  status: 'Draft',
  lines: [
    { id: uuid(11), costTypeId: ALIMENT, quantity: 20, unitPrice: 17_500, received: 0 },
    { id: uuid(12), costTypeId: POUSSINS, quantity: 1000, unitPrice: 550, received: 0 },
  ],
  billable: 0,
  paid: 0,
  payments: [],
  ...fields,
});

describe('Les achats, au bureau', () => {
  let http: HttpTestingController;

  const ouvre = async (url: string, orders: OrderView[] = [uneCommande()]) => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([{ path: 'admin', children: adminRoutes }]), { provide: CLOCK, useValue: { now: () => NOW } }, { provide: OFFICE_QUEUE, useFactory: () => OfficeQueue.open(new IDBFactory()) }],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    const refresh = async () => {
      await settle();
      harness.detectChanges();
      await harness.fixture.whenStable();
      harness.detectChanges();
    };
    const answerReadings = () => {
      http.match('/api/v1/caretaker/context').forEach((request) => request.flush(contexte()));
      http.match('/api/v1/orders').forEach((request) => request.flush(orders));
      http.match('/api/v1/counterparties').forEach((request) => request.flush(tiers()));
      http.match('/api/v1/cost-types').forEach((request) => request.flush(types()));
      http.match('/api/v1/reference-data').forEach((request) => request.flush({ currency: 'XOF', costCategories: [], lossTypes: [], strains: [] }));
    };
    answerReadings();
    await refresh();
    answerReadings();
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
      const input = element().querySelector<HTMLInputElement>(selector);
      if (input === null) throw new Error(`No field: ${selector}`);
      input.value = value;
      input.dispatchEvent(new Event('input'));
      await refresh();
    };
    const soon = (check: () => void) => vi.waitFor(async () => {
      await refresh();
      check();
    });
    const sent = (method: string, url: string) => {
      let found: TestRequest | undefined;
      return soon(() => {
        found = http.match((request) => request.method === method && request.url === url)[0] ?? found;
        expect(found).toBeDefined();
      }).then(() => found as TestRequest);
    };
    return { harness, element, all, tap, type, soon, sent, refresh, answerReadings };
  };
  const text = (node: Element | null | undefined) => node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('yaar.session', JSON.stringify({ token, expiresAt: '2099-01-01T00:00:00.000Z', role: 'admin', account: { name: 'Bassirou', avatar: 'baobab', language: 'fr' } }));
  });

  describe('la liste des commandes', () => {
    it('chaque commande dit son fournisseur, son lot, son état en picto et en mot, et son montant : commandé pour un brouillon', async () => {
      const { all } = await ouvre('/admin/achats');

      const [card] = all('.order');
      expect(text(card)).toMatch(/Sedima.*Poulailler Nord · Jour 11.*Brouillon.*900 000 F commandés/);
      expect(card?.querySelector('.status use')?.getAttribute('href')).toContain('#pencil');
    });

    it('une commande reçue en partie dit ce qui est reçu, son facturable, et qu’elle n’est pas payée', async () => {
      const { all } = await ouvre('/admin/achats', [uneCommande({ status: 'PartiallyReceived', billable: 140_000, lines: [{ id: uuid(11), costTypeId: ALIMENT, quantity: 20, unitPrice: 17_500, received: 8 }] })]);

      expect(text(all('.order')[0])).toMatch(/En partie reçue.*140 000 F à payer.*rien payé/);
    });

    it('sans commande, la page le dit', async () => {
      const { element } = await ouvre('/admin/achats', []);

      expect(text(element().querySelector('.none'))).toContain('Aucune commande pour l’instant');
    });

    it('un brouillon s’annonce au gardien d’un geste, et la liste est relue', async () => {
      const { tap, sent, all, soon } = await ouvre('/admin/achats');

      await tap('.order .announce');
      (await sent('POST', `/api/v1/orders/${uuid(1)}/announce`)).flush(null, { status: 204, statusText: 'No Content' });

      let reread = false;
      await soon(() => {
        for (const request of http.match('/api/v1/orders')) {
          reread = true;
          request.flush([uneCommande({ status: 'Announced' })]);
        }
        http.match('/api/v1/counterparties').forEach((request) => request.flush(tiers()));
        http.match('/api/v1/cost-types').forEach((request) => request.flush(types()));
        http.match('/api/v1/reference-data').forEach((request) => request.flush({ currency: 'XOF', costCategories: [], lossTypes: [], strains: [] }));
        expect(reread).toBe(true);
      });
      await soon(() => expect(all('.order .announce')).toHaveLength(0));
      expect(text(all('.order')[0])).toContain('Annoncée au gardien');
    });

    it('seul un brouillon offre « Annoncer » : une commande annoncée ne le propose plus', async () => {
      const { all } = await ouvre('/admin/achats', [uneCommande({ status: 'Announced' })]);

      expect(all('.order .announce')).toHaveLength(0);
      expect(text(all('.order')[0])).toContain('Annoncée au gardien');
    });

    it('« Nouvelle commande » mène à l’éditeur', async () => {
      const { tap } = await ouvre('/admin/achats');

      await tap('a.new-order');

      expect(TestBed.inject(Router).url).toBe('/admin/achats/nouvelle');
    });
  });

  describe("l'éditeur", () => {
    it('le seul lot en cours est choisi d’avance, la date est celle du jour ; aucun fournisseur n’est choisi pour l’admin', async () => {
      const { element } = await ouvre('/admin/achats/nouvelle');

      expect(element().querySelector<HTMLInputElement>('input[name=lot]:checked')?.value).toBe(BANDE);
      expect(element().querySelector<HTMLInputElement>('input[name=orderDay]')?.value).toBe('2026-10-12');
      expect(element().querySelector('input[name=supplier]:checked')).toBeNull();
    });

    it('les fournisseurs se choisissent sur leur visage et leur nom ; ni client, ni fournisseur archivé', async () => {
      const { all } = await ouvre('/admin/achats/nouvelle');

      expect(all('.supplier').map(text)).toEqual(['Sedima', 'Touba Avicole', 'Nouveau fournisseur']);
      expect(all('.supplier use')[0]?.getAttribute('href')).toContain('#closed-bag');
    });

    it('une ligne se compose d’un type commandable, d’une quantité et d’un prix ; le total se refait pendant la frappe', async () => {
      const { all, tap, type, element } = await ouvre('/admin/achats/nouvelle');

      expect(all('.line:first-child .type-choice').map(text)).toEqual(['Aliment', 'Poussins']);
      await tap('.line:first-child .type-choice input[value="' + ALIMENT + '"]');
      await type('.line:first-child input[name=quantity]', '20');
      await type('.line:first-child input[name=unitPrice]', '17500');
      expect(text(element().querySelector('.total'))).toContain('350 000 F');

      await tap('button.add-line');
      await tap('.line:nth-child(2) .type-choice input[value="' + POUSSINS + '"]');
      await type('.line:nth-child(2) input[name=quantity]', '1000');
      await type('.line:nth-child(2) input[name=unitPrice]', '550');
      // 20 × 17 500 + 1 000 × 550 = 900 000 F
      expect(text(element().querySelector('.total'))).toContain('900 000 F');
    });

    it('« Enregistrer » envoie le brouillon, avec des identifiants créés ici, puis revient aux achats', async () => {
      const { tap, type, sent, soon } = await ouvre('/admin/achats/nouvelle');
      await tap('input[name=supplier][value="' + SEDIMA + '"]');
      await tap('.line:first-child .type-choice input[value="' + ALIMENT + '"]');
      await type('.line:first-child input[name=quantity]', '20');
      await type('.line:first-child input[name=unitPrice]', '17500');
      await type('input[name=reference]', 'BC-0412');

      await tap('form button[type=submit]');

      const request = await sent('POST', '/api/v1/orders');
      expect(request.request.body as DraftOrderRequest).toEqual({
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        supplierId: SEDIMA,
        campaignId: BANDE,
        orderDay: '2026-10-12',
        reference: 'BC-0412',
        lines: [{ id: expect.stringMatching(/^[0-9a-f-]{36}$/), costTypeId: ALIMENT, quantity: 20, unitPrice: 17_500 }],
      });
      request.flush(null, { status: 201, statusText: 'Created' });
      await soon(() => expect(TestBed.inject(Router).url).toBe('/admin/achats'));
    });

    it('la règle du domaine refuse avant tout envoi, et le dit : sans fournisseur, sans type sur une ligne', async () => {
      const { tap, element } = await ouvre('/admin/achats/nouvelle');

      await tap('form button[type=submit]');
      expect(text(element().querySelector('.refusal'))).toContain('Choisis le fournisseur');

      await tap('input[name=supplier][value="' + SEDIMA + '"]');
      await tap('form button[type=submit]');
      expect(text(element().querySelector('.refusal'))).toContain('Choisis ce que tu commandes');
      expect(http.match((request) => request.method === 'POST')).toEqual([]);
    });

    it('un fournisseur se crée sur place : son nom, son visage ; il est aussitôt choisi', async () => {
      const { tap, type, sent, element, soon } = await ouvre('/admin/achats/nouvelle');

      await tap('.supplier.new input');
      await type('input[name=supplierName]', 'Senegal Aliment');
      await tap('.faces input[value=truck]');
      await tap('button.create-supplier');

      const request = await sent('POST', '/api/v1/counterparties');
      expect(request.request.body).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), kind: 'Supplier', name: 'Senegal Aliment', face: 'truck' });
      request.flush(null, { status: 201, statusText: 'Created' });
      await soon(() => expect(text(element().querySelector('input[name=supplier]:checked')?.closest('label'))).toBe('Senegal Aliment'));
    });

    it('un brouillon se rouvre tel qu’il est écrit, et « Enregistrer » le réécrit', async () => {
      const { element, tap, sent } = await ouvre(`/admin/achats/${uuid(1)}`);

      expect(element().querySelector<HTMLInputElement>('input[name=supplier]:checked')?.value).toBe(SEDIMA);
      expect(Array.from(element().querySelectorAll<HTMLInputElement>('input[name=quantity]')).map((input) => input.value)).toEqual(['20', '1000']);
      await tap('form button[type=submit]');

      const request = await sent('PUT', `/api/v1/orders/${uuid(1)}`);
      expect((request.request.body as DraftOrderRequest).lines.map(({ id }) => id)).toEqual([uuid(11), uuid(12)]);
    });

    it('sans réseau, le brouillon n’est pas enregistré, et il le dit', async () => {
      const { tap, type, sent, soon, element } = await ouvre('/admin/achats/nouvelle');
      await tap('input[name=supplier][value="' + SEDIMA + '"]');
      await tap('.line:first-child .type-choice input[value="' + ALIMENT + '"]');
      await type('.line:first-child input[name=quantity]', '20');
      await type('.line:first-child input[name=unitPrice]', '17500');
      await tap('form button[type=submit]');

      (await sent('POST', '/api/v1/orders')).error(new ProgressEvent('error'));

      await soon(() => expect(text(element().querySelector('.refusal'))).toContain('Pas de réseau'));
      expect(TestBed.inject(Router).url).toBe('/admin/achats/nouvelle');
    });
  });

  describe('payer une commande', () => {
    // The order of 12/10, received whole: 20 × 17 500 + 1 000 × 550 = 900 000 F to pay; 400 000 F paid by Wave on 13/10.
    const recue = (fields: Partial<OrderView> = {}) =>
      uneCommande({
        status: 'Received',
        billable: 900_000,
        paid: 400_000,
        payments: [{ id: uuid(501), paidOn: '2026-10-13', amount: 400_000, method: 'Wave', paidBy: null }],
        lines: [
          { id: uuid(11), costTypeId: ALIMENT, quantity: 20, unitPrice: 17_500, received: 20 },
          { id: uuid(12), costTypeId: POUSSINS, quantity: 1000, unitPrice: 550, received: 1000 },
        ],
        ...fields,
      });
    const PAGE = `/admin/achats/${uuid(1)}/payer`;

    it('chaque commande offre « Payer », qui mène à sa page de paiement — un brouillon aussi (un acompte)', async () => {
      const { all, tap } = await ouvre('/admin/achats', [recue(), uneCommande({ id: uuid(2) })]);

      expect(all('.order .pay').map((link) => link.getAttribute('href'))).toEqual([PAGE, `/admin/achats/${uuid(2)}/payer`]);
      await tap('.order .pay');
      expect(TestBed.inject(Router).url).toBe(PAGE);
    });

    it('la page dit le facturable, le payé et le reste à payer, et liste les paiements déjà faits avec leur moyen', async () => {
      const { element, all } = await ouvre(PAGE, [recue()]);

      expect(text(element().querySelector('h1'))).toContain('Payer Sedima');
      expect(text(element().querySelector('.balance'))).toMatch(/À payer 900 000 F.*Déjà payé 400 000 F.*Reste à payer 500 000 F/);
      expect(all('.paid-list li').map(text)).toEqual(['13/10/2026 Wave 400 000 F']);
    });

    it('le montant proposé est le reste à payer, la date celle du jour ; aucun moyen n’est choisi pour l’admin', async () => {
      const { element, all } = await ouvre(PAGE, [recue()]);

      expect(element().querySelector<HTMLInputElement>('input[name=amount]')?.value).toBe('500000');
      expect(element().querySelector<HTMLInputElement>('input[name=paidOn]')?.value).toBe('2026-10-12');
      expect(all('.method').map(text)).toEqual(['Espèces', 'Wave', 'Orange Money']);
      expect(all('.method input').filter((input) => (input as HTMLInputElement).checked)).toEqual([]);
    });

    it('chaque moyen porte son picto, sa couleur et son mot : la pièce pour les espèces, le téléphone pour Wave et Orange Money', async () => {
      const { all } = await ouvre(PAGE, [recue()]);

      expect(all('.method').map((tile) => [tile.className.match(/method-\w+/)?.[0], tile.querySelector('use')?.getAttribute('href')?.split('#')[1]])).toEqual([
        ['method-cash', 'coin'],
        ['method-wave', 'mobile-money'],
        ['method-orange', 'mobile-money'],
      ]);
    });

    it('« Payer » envoie le paiement, avec un identifiant créé ici, puis revient aux achats', async () => {
      const { tap, sent } = await ouvre(PAGE, [recue()]);

      await tap('.method-orange input');
      await tap('form .go');
      const request = await sent('POST', `/api/v1/orders/${uuid(1)}/payments`);
      expect(request.request.body).toEqual({ id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/), paidOn: '2026-10-12', amount: 500_000, method: 'OrangeMoney' });
      request.flush(null, { status: 201, statusText: 'Created' });
      await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe('/admin/achats'));
    });

    it('la règle du domaine refuse avant tout envoi, et le dit : sans moyen, un montant nul ou fractionnaire', async () => {
      const { tap, type, element } = await ouvre(PAGE, [recue()]);
      const refus = () => text(element().querySelector('.refusal'));

      await tap('form .go');
      expect(refus()).toContain('Choisis comment tu as payé');
      await tap('.method-cash input');
      await type('input[name=amount]', '0');
      await tap('form .go');
      expect(refus()).toContain('Un montant en francs entiers, d’au moins 1 F');
      await type('input[name=amount]', '99.5');
      await tap('form .go');
      expect(refus()).toContain('Un montant en francs entiers, d’au moins 1 F');
      expect(http.match((request) => request.method === 'POST')).toEqual([]);
    });

    it('rien de reçu encore : aucun montant proposé, et la page dit que ce paiement est une avance', async () => {
      const { element } = await ouvre(PAGE, [uneCommande({ status: 'Announced' })]);

      expect(text(element().querySelector('.balance'))).toContain('Rien de reçu encore : ce paiement est une avance');
      expect(element().querySelector<HTMLInputElement>('input[name=amount]')?.value).toBe('');
    });

    it('payé plus que le facturable : la page dit que le fournisseur doit à l’élevage', async () => {
      const { element } = await ouvre(PAGE, [recue({ paid: 950_000, payments: [{ id: uuid(501), paidOn: '2026-10-13', amount: 950_000, method: 'Cash', paidBy: null }] })]);

      expect(text(element().querySelector('.balance'))).toContain('Sedima te doit 50 000 F');
      expect(element().querySelector<HTMLInputElement>('input[name=amount]')?.value).toBe('');
    });

    // Spec: backlog P.8 — les frais Wave et Orange Money (décisions du 2026-11-12).
    it('Wave ou Orange Money choisi : une case « Frais » apparaît, vide ; en espèces, aucune', async () => {
      const { tap, element } = await ouvre(PAGE, [recue()]);
      const fee = () => element().querySelector<HTMLInputElement>('input[name=fee]');

      expect(fee()).toBeNull();
      await tap('.method-wave input');
      expect(fee()?.value).toBe('');
      expect(text(element().querySelector('app-fee-field'))).toContain('Frais Wave payés par toi');
      await tap('.method-orange input');
      expect(text(element().querySelector('app-fee-field'))).toContain('Frais Orange Money payés par toi');
      await tap('.method-cash input');
      expect(fee()).toBeNull();
    });

    it('des frais tapés : le paiement garde son montant entier, puis les frais partent comme une dépense payée de la bande, « Frais financiers », le même jour', async () => {
      const { tap, type, sent } = await ouvre(PAGE, [recue()]);

      await tap('.method-wave input');
      await type('input[name=fee]', '5000');
      await tap('form .go');
      const payment = await sent('POST', `/api/v1/orders/${uuid(1)}/payments`);
      expect(payment.request.body).toEqual(expect.objectContaining({ amount: 500_000, method: 'Wave' }));
      payment.flush(null, { status: 201, statusText: 'Created' });
      const fee = await sent('POST', '/api/v1/costs');
      expect(fee.request.body).toEqual({
        id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
        campaignId: BANDE,
        costTypeId: FRAIS,
        spentOn: '2026-10-12',
        amount: 5_000,
        note: 'Frais Wave — paiement Sedima',
        payment: { kind: 'Paid' },
        receipt: null,
        recordedAt: expect.any(String),
      });
    });

    it('les frais vont à la bande de la commande, même quand ce n’est pas le premier lot', async () => {
      const AUTRE_BANDE = uuid(9);
      const { tap, type, sent } = await ouvre(PAGE, [recue({ campaignId: AUTRE_BANDE })]);

      await tap('.method-wave input');
      await type('input[name=fee]', '5000');
      await tap('form .go');
      (await sent('POST', `/api/v1/orders/${uuid(1)}/payments`)).flush(null, { status: 201, statusText: 'Created' });
      expect((await sent('POST', '/api/v1/costs')).request.body).toEqual(expect.objectContaining({ campaignId: AUTRE_BANDE }));
    });

    it('des frais vides ou à zéro : aucune dépense ; des frais qui ne sont pas des francs entiers sont refusés avant tout envoi', async () => {
      const { tap, type, sent, element, refresh } = await ouvre(PAGE, [recue()]);

      await tap('.method-wave input');
      await type('input[name=fee]', '12.5');
      await tap('form .go');
      expect(text(element().querySelector('.refusal'))).toContain('Les frais : des francs entiers, ou rien');
      expect(http.match((request) => request.method === 'POST')).toEqual([]);

      await type('input[name=fee]', '0');
      await tap('form .go');
      (await sent('POST', `/api/v1/orders/${uuid(1)}/payments`)).flush(null, { status: 201, statusText: 'Created' });
      await refresh();
      await refresh();
      expect(http.match((request) => request.method === 'POST' && request.url === '/api/v1/costs')).toEqual([]);
    });

    // Spec: backlog R.4 — une commande payée par un tiers (décisions du 2026-11-12).
    it('« Plus de détails » : payé par quelqu’un d’autre — tout tiers en usage, sauf le fournisseur de la commande', async () => {
      const { all, element } = await ouvre(PAGE, [recue()]);

      expect(text(element().querySelector('.payer-more summary'))).toBe('Plus de détails : payé par quelqu’un d’autre');
      expect(all('.payer').map(text)).toEqual(['Touba Avicole', 'Ramasseur']);
    });

    it('payée par l’acheteur, par Wave, ses frais à ta charge : le paiement nomme qui a payé ; les frais partent « payés par » lui', async () => {
      const { tap, type, sent, element } = await ouvre(PAGE, [recue()]);

      await tap('.payer:nth-child(2)');
      await tap('.method-wave input');
      expect(text(element().querySelector('app-fee-field'))).toContain('Frais Wave payés par Ramasseur, à ta charge');
      await type('input[name=fee]', '2000');
      await tap('form .go');

      const payment = await sent('POST', `/api/v1/orders/${uuid(1)}/payments`);
      expect(payment.request.body).toEqual(expect.objectContaining({ amount: 500_000, method: 'Wave', paidBy: uuid(34) }));
      payment.flush(null, { status: 201, statusText: 'Created' });
      expect((await sent('POST', '/api/v1/costs')).request.body).toEqual(expect.objectContaining({ amount: 2_000, note: 'Frais Wave — paiement Sedima payé par Ramasseur', payment: { kind: 'PaidBy', counterpartyId: uuid(34) } }));
    });

    it('payée par un tiers en espèces : aucune case « Frais »', async () => {
      const { tap, element } = await ouvre(PAGE, [recue()]);

      await tap('.payer:nth-child(2)');
      await tap('.method-cash input');
      expect(element().querySelector('input[name=fee]')).toBeNull();
    });

    it('un paiement déjà fait par un tiers le dit dans la liste', async () => {
      const { all } = await ouvre(PAGE, [recue({ payments: [{ id: uuid(501), paidOn: '2026-10-13', amount: 400_000, method: 'Wave', paidBy: uuid(34) }] })]);

      expect(all('.paid-list li').map(text)).toEqual(['13/10/2026 Wave, payé par Ramasseur 400 000 F']);
    });

    // Spec: backlog P.7 — un paiement saisi sans réseau est gardé sur l'appareil, et part au retour du réseau, une seule fois.
    it('sans réseau, le paiement est gardé et la carte dit « paiement en attente d’envoi » ; au retour du réseau, le même paiement repart', async () => {
      const { tap, sent, element, soon } = await ouvre(PAGE, [recue()]);

      await tap('.method-wave input');
      await tap('form .go');
      const first = await sent('POST', `/api/v1/orders/${uuid(1)}/payments`);
      const id = (first.request.body as { id: string }).id;
      first.error(new ProgressEvent('error'));
      await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe('/admin/achats'));
      await soon(() => expect(text(element().querySelector('.order .waiting'))).toContain('paiement en attente d’envoi'));

      globalThis.dispatchEvent(new Event('online'));
      const retried = await sent('POST', `/api/v1/orders/${uuid(1)}/payments`);
      expect((retried.request.body as { id: string }).id).toBe(id);
    });
  });
});
