import { provideHttpClient } from '@angular/common/http';
import { IDBFactory } from 'fake-indexeddb';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { CaretakerContext, CounterpartyView, ReceptionsView, CostTypeView, DraftOrderRequest, OrderView } from '@contracts';
import { CLOCK } from '../../core/clock';
import { OfficeQueue } from '../../core/outbox/office-queue';
import { OFFICE_QUEUE } from '../office-sync';
import { REDUCE_PHOTO } from '../../core/media/reduce-photo';
import { adminRoutes } from '../admin.routes';

// Spec: backlog Q.5 — l'éditeur de commande ; cahier des charges « Commandes » (au bureau, en
// ligne ; un fournisseur se crée sur place : décision du 2026-11-09) ; « Un bureau pour ceux qui ne
// lisent pas » (un picto d'objet réel et le mot) ; le total de la saisie vient de domain/finance.
// Et backlog Q.9 — payer une commande ; cahier des charges « Payer une commande » (décision du 2026-11-11).

// A photo of an invoice, as the reducer hands it over (R.6)
const FACTURE = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
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
  { id: SEDIMA, kind: 'Supplier', name: 'Sedima', face: 'closed-bag', advancesExpenses: false, archived: false },
  { id: TOUBA_AVICOLE, kind: 'Supplier', name: 'Touba Avicole', face: 'chick', advancesExpenses: false, archived: false },
  { id: uuid(33), kind: 'Supplier', name: 'Ancien fournisseur', face: 'truck', advancesExpenses: false, archived: true },
  { id: uuid(34), kind: 'Customer', name: 'Ramasseur', face: 'hen', advancesExpenses: true, archived: false },
];
// The farm's type of the « Frais financiers » category: what a Wave or Orange Money fee is written as (P.8).
const FRAIS = uuid(45);
const AU_KG = uuid(46);
const types = (): CostTypeView[] => [
  { id: ALIMENT, category: 'Feed', name: 'Aliment', behaviour: 'Variable', bagWeight: 50_000, orderable: true, archived: false },
  { id: POUSSINS, category: 'Chicks', name: 'Poussins', behaviour: 'Variable', bagWeight: null, orderable: true, archived: false },
  { id: uuid(43), category: 'Labour', name: 'Salaire du gardien', behaviour: 'Fixed', bagWeight: null, orderable: false, archived: false },
  { id: uuid(44), category: 'Processing', name: 'Déplumage', behaviour: 'Variable', bagWeight: null, orderable: false, archived: true },
  { id: FRAIS, category: 'FinancialCharges', name: 'Frais financiers', behaviour: 'Fixed', bagWeight: null, orderable: false, archived: false },
  // Feed bought by weight: no usual weight of a bag (N.8a)
  { id: AU_KG, category: 'Feed', name: 'Aliment au kg', behaviour: 'Variable', bagWeight: null, orderable: true, archived: false },
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
    { id: uuid(11), costTypeId: ALIMENT, quantity: 20, unitPrice: 17_500, bagWeight: null, received: 0 },
    { id: uuid(12), costTypeId: POUSSINS, quantity: 1000, unitPrice: 550, bagWeight: null, received: 0 },
  ],
  billable: 0,
  paid: 0,
  payments: [],
  attachments: [],
  ...fields,
});

describe('Les achats, au bureau', () => {
  let http: HttpTestingController;

  const ouvre = async (url: string, orders: OrderView[] = [uneCommande()], receptions: ReceptionsView = { today: '2026-11-20', receptions: [] }) => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([{ path: 'admin', children: adminRoutes }]), { provide: CLOCK, useValue: { now: () => NOW } }, { provide: OFFICE_QUEUE, useFactory: () => OfficeQueue.open(new IDBFactory()) }, { provide: REDUCE_PHOTO, useValue: async () => FACTURE }],
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
      http.match('/api/v1/receptions').forEach((request) => request.flush(receptions));
      http.match({ method: 'GET', url: '/api/v1/corrections/to-review' }).forEach((request) => request.flush([]));
      http.match({ method: 'GET', url: '/api/v1/counterparties' }).forEach((request) => request.flush(tiers()));
      http.match('/api/v1/cost-types').forEach((request) => request.flush(types()));
      http.match('/api/v1/reference-data').forEach((request) => request.flush({ currency: 'XOF', costCategories: [], lossTypes: [], strains: [] }));
      // The prices the farm knows (N.5): the bag of feed at 17 500 F from Sedima, then 16 000 F from Touba.
      http.match('/api/v1/price-catalog').forEach((request) =>
        request.flush({
          currency: 'XOF',
          prices: [
            { costTypeId: ALIMENT, supplierId: SEDIMA, unitPrice: 17_500, at: '2026-10-12T09:00:00.000Z' },
            { costTypeId: ALIMENT, supplierId: TOUBA_AVICOLE, unitPrice: 16_000, at: '2026-11-01T09:00:00.000Z' },
          ],
        }),
      );
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
    const sent = (method: string, url: string | RegExp) => {
      let found: TestRequest | undefined;
      return soon(() => {
        found = http.match((request) => request.method === method && (typeof url === 'string' ? request.url === url : url.test(request.url)))[0] ?? found;
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
      expect(text(card)).toMatch(/Sedima.*Poulailler Nord · Jour 11.*Brouillon.*900 000 FCFA commandés/);
      expect(card?.querySelector('.status use')?.getAttribute('href')).toContain('#pencil');
    });

    it('une commande reçue en partie dit ce qui est reçu, son facturable, et qu’elle n’est pas payée', async () => {
      const { all } = await ouvre('/admin/achats', [uneCommande({ status: 'PartiallyReceived', billable: 140_000, lines: [{ id: uuid(11), costTypeId: ALIMENT, quantity: 20, unitPrice: 17_500, bagWeight: null, received: 8 }] })]);

      expect(text(all('.order')[0])).toMatch(/En partie reçue.*140 000 FCFA à payer.*rien payé/);
    });

    // Spec: backlog Q.12 — relire une commande (demande du fondateur du 2026-11-13)
    describe('relire une commande', () => {
      const annoncee = () =>
        uneCommande({
          status: 'PartiallyReceived',
          reference: 'BC-0412',
          billable: 140_000,
          paid: 100_000,
          lines: [
            { id: uuid(11), costTypeId: ALIMENT, quantity: 20, unitPrice: 17_500, bagWeight: 50_000, received: 8 },
            { id: uuid(12), costTypeId: POUSSINS, quantity: 1000, unitPrice: 550, bagWeight: null, received: 1050 },
          ],
          payments: [{ id: uuid(61), paidOn: '2026-10-14', amount: 100_000, method: 'Wave', paidBy: TOUBA_AVICOLE, attachments: [] }],
        });

      it('une commande annoncée s’ouvre en lecture ; un brouillon, toujours dans l’éditeur', async () => {
        const { tap, all } = await ouvre('/admin/achats', [annoncee(), uneCommande({ id: uuid(2) })]);
        expect(all('.order a.open').map((link) => link.getAttribute('href'))).toEqual([`/admin/achats/${uuid(1)}/fiche`, `/admin/achats/${uuid(2)}`]);
        await tap('.order a.open');
        expect(TestBed.inject(Router).url).toBe(`/admin/achats/${uuid(1)}/fiche`);
      });

      it('la fiche : chaque ligne avec son prix, son total, son poids de sac, le reçu et le reste ; puis les paiements et qui a payé', async () => {
        const { element, all } = await ouvre(`/admin/achats/${uuid(1)}/fiche`, [annoncee()]);

        expect(text(element().querySelector('.sheet-head'))).toMatch(/Sedima.*12\/10\/2026.*BC-0412.*En partie reçue/);
        // 20 × 17 500 = 350 000 ; 1 000 × 550 = 550 000 ; un bonus de 50 poussins se dit, signé
        expect(all('.sheet-line').map(text)).toEqual([
          'Aliment 20 sacs × 17 500 FCFA = 350 000 FCFA sac de 50 kg reçu 8 reste 12',
          'Poussins 1 000 poussins × 550 FCFA = 550 000 FCFA reçu 1 050 +50',
        ]);
        expect(text(element().querySelector('.sheet-total'))).toBe('Commandé 900 000 FCFA');
        expect(all('.sheet-payment .payment-words').map(text)).toEqual(['14/10/2026 100 000 FCFA par Wave, payé par Touba Avicole']);
        // Nothing to type: the sheet is read; a photo is joined from it, nothing else changes
        expect(element().querySelector('input:not([type=file]), textarea')).toBeNull();
      });

      // Spec: backlog R.6 — les justificatifs : les joindre, même plus tard, et les voir
      describe('les justificatifs', () => {
        const PHOTO = 'a'.repeat(64);
        beforeEach(() => {
          vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:photo');
          vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
        });
        afterEach(() => vi.restoreAllMocks());

        it('la fiche montre les photos de la commande et de chaque paiement ; un tap ouvre la photo, lue au serveur', async () => {
          const avecPhotos = { ...annoncee(), attachments: [PHOTO], payments: [{ ...annoncee().payments[0]!, attachments: [PHOTO] }] };
          const { tap, element, refresh } = await ouvre(`/admin/achats/${uuid(1)}/fiche`, [avecPhotos]);

          expect(element().querySelectorAll('.order-photos .photo')).toHaveLength(1);
          expect(element().querySelectorAll('.sheet-payment .photo')).toHaveLength(1);
          await tap('.order-photos .photo');
          const lecture = http.expectOne(`/api/v1/media/${PHOTO}`);
          expect(lecture.request.responseType).toBe('blob');
          lecture.flush(new Blob([FACTURE], { type: 'image/jpeg' }));
          await vi.waitFor(async () => {
            await refresh();
            expect(element().querySelector<HTMLImageElement>('.photo-viewer img')?.getAttribute('src')).toBe('blob:photo');
          });
        });

        it('« Joindre une photo » : la photo part d’abord, puis la jointure — la commande ne change pas ; la liste se relit', async () => {
          const { element, sent, refresh } = await ouvre(`/admin/achats/${uuid(1)}/fiche`, [annoncee()]);
          const camera = element().querySelector<HTMLInputElement>('.order-photos input[type=file]');
          Object.defineProperty(camera, 'files', { value: [new File([FACTURE], 'facture.jpg', { type: 'image/jpeg' })], configurable: true });
          camera?.dispatchEvent(new Event('change'));
          await refresh();

          const depot = await sent('PUT', /^\/api\/v1\/media\/[0-9a-f]{64}$/);
          expect(depot.request.params.get('retention')).toBe('SupportingDocument');
          depot.flush(null, { status: 201, statusText: 'Created' });
          const jointure = await sent('POST', '/api/v1/attachments');
          expect(jointure.request.body).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), subjectKind: 'Order', subjectId: uuid(1), media: depot.request.url.slice('/api/v1/media/'.length) });
          // Joined: the orders are read again, to show the new photo
          http.match('/api/v1/orders');
          jointure.flush(null, { status: 201, statusText: 'Created' });
          await vi.waitFor(() => expect(http.match('/api/v1/orders')).not.toHaveLength(0));
        });

        it('une photo jointe à un paiement part comme paiement, avec l’identifiant de ce paiement', async () => {
          const { element, sent, refresh } = await ouvre(`/admin/achats/${uuid(1)}/fiche`, [annoncee()]);
          const camera = element().querySelector<HTMLInputElement>('.sheet-payment input[type=file]');
          Object.defineProperty(camera, 'files', { value: [new File([FACTURE], 'recu.jpg', { type: 'image/jpeg' })], configurable: true });
          camera?.dispatchEvent(new Event('change'));
          await refresh();

          (await sent('PUT', /^\/api\/v1\/media\/[0-9a-f]{64}$/)).flush(null, { status: 201, statusText: 'Created' });
          expect((await sent('POST', '/api/v1/attachments')).request.body).toMatchObject({ subjectKind: 'Payment', subjectId: uuid(61) });
        });
      });
    });

    // Spec: backlog Q.14 — les réceptions prévues (décisions du fondateur du 2026-11-13)
    describe('les réceptions prévues', () => {
      // An order of 20 bags of feed and 1 000 chicks: the chicks came, the feed in two times
      const enDeuxFois = () => uneCommande({ status: 'PartiallyReceived', lines: [{ id: uuid(11), costTypeId: ALIMENT, quantity: 20, unitPrice: 17_500, bagWeight: 50_000, received: 6 }, { id: uuid(12), costTypeId: POUSSINS, quantity: 1000, unitPrice: 550, bagWeight: null, received: 1000 }] });
      const suivi = (): ReceptionsView => ({
        today: '2026-11-20',
        receptions: [
          { receptionId: uuid(701), orderId: uuid(1), supplierId: SEDIMA, campaignId: BANDE, plannedOn: '2026-11-15', previousDates: ['2026-11-12'], state: 'Late', lines: [{ orderLineId: uuid(11), costTypeId: ALIMENT, expected: 10, received: 6, remaining: 4 }] },
          { receptionId: uuid(702), orderId: uuid(1), supplierId: SEDIMA, campaignId: BANDE, plannedOn: '2026-11-25', previousDates: [], state: 'Coming', lines: [{ orderLineId: uuid(11), costTypeId: ALIMENT, expected: 10, received: 0, remaining: 10 }] },
        ],
      });

      it('la fiche montre ses réceptions prévues : la date (et celle d’avant, si reprogrammée), l’état, ce qui est reçu et ce qui reste', async () => {
        const { all } = await ouvre(`/admin/achats/${uuid(1)}/fiche`, [enDeuxFois()], suivi());
        expect(all('.reception').map(text)).toEqual([
          expect.stringMatching(/15\/11\/2026.*prévue d’abord le 12\/11\/2026.*En retard.*Aliment 6 \/ 10 reçus, reste 4/),
          expect.stringMatching(/25\/11\/2026.*À venir.*Aliment 0 \/ 10 reçus, reste 10/),
        ]);
      });

      it('une commande reçue en une fois n’a rien à prévoir : pas de réception prévue, juste le bouton pour en prévoir une', async () => {
        const { element } = await ouvre(`/admin/achats/${uuid(1)}/fiche`, [enDeuxFois()]);
        expect(element().querySelectorAll('.reception')).toHaveLength(0);
        expect(element().querySelector('button.plan-reception')).not.toBeNull();
      });

      it('une commande entièrement reçue n’a plus rien à recevoir : pas de réceptions prévues à écrire', async () => {
        const { element } = await ouvre(`/admin/achats/${uuid(1)}/fiche`, [{ ...enDeuxFois(), status: 'Received' }]);
        expect(element().querySelector('app-order-receptions')).toBeNull();
      });

      it('la fiche d’un brouillon offre les deux gestes, l’un ou l’autre : « Prévenir le gardien » l’annonce en une fois', async () => {
        const { all, tap, sent } = await ouvre(`/admin/achats/${uuid(1)}/fiche`, [uneCommande()]);

        expect(text(all('.sheet-modes .announce')[0])).toBe('Prévenir le gardien');
        expect(text(all('app-order-receptions .plan-reception')[0])).toBe('Déclarer des réceptions');
        await tap('.sheet-modes .announce');
        (await sent('POST', `/api/v1/orders/${uuid(1)}/announce`)).flush(null, { status: 204, statusText: 'No Content' });
      });

      it('venu de « Déclarer des réceptions », le formulaire est ouvert ; la première réception prévue part au serveur, qui annonce la commande', async () => {
        const { element, type, tap, sent } = await ouvre(`/admin/achats/${uuid(1)}/fiche?receptions=declarer`, [uneCommande()]);

        expect(element().querySelector('app-order-receptions .reception-form')).not.toBeNull();
        await type('app-order-receptions input[name="plannedOn"]', '2026-11-25');
        await tap('app-order-receptions .write');
        const request = await sent('PUT', new RegExp(`^/api/v1/orders/${uuid(1)}/receptions/[0-9a-f-]{36}$`));
        expect((request.request.body as { plannedOn: string }).plannedOn).toBe('2026-11-25');
      });

      it('une commande annoncée n’offre plus « Prévenir le gardien »', async () => {
        const { all } = await ouvre(`/admin/achats/${uuid(1)}/fiche`, [enDeuxFois()], suivi());
        expect(all('.sheet-modes .announce')).toHaveLength(0);
      });

      it('« Prévoir une réception » : une date, et pour chaque ligne ce qui n’est pas encore prévu, pré-rempli ; une ligne à zéro ne part pas', async () => {
        const { tap, type, element, sent } = await ouvre(`/admin/achats/${uuid(1)}/fiche`, [enDeuxFois()], { today: '2026-11-20', receptions: [suivi().receptions[0]!] });
        await tap('button.plan-reception');
        // Aliment : 20 commandés, 10 déjà prévus → 10 ; poussins : tout reçu, rien prévu → 1 000 proposés
        expect([element().querySelector<HTMLInputElement>(`.reception-form input[name="q-${uuid(11)}"]`)?.value, element().querySelector<HTMLInputElement>(`.reception-form input[name="q-${uuid(12)}"]`)?.value]).toEqual(['10', '1 000']);
        await type('.reception-form input[name=plannedOn]', '2026-11-28');
        await type(`.reception-form input[name="q-${uuid(12)}"]`, '0');
        await tap('.reception-form button.write');

        const request = await sent('PUT', new RegExp(`^/api/v1/orders/${uuid(1)}/receptions/[0-9a-f-]{36}$`));
        expect(request.request.body).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), plannedOn: '2026-11-28', lines: [{ orderLineId: uuid(11), quantity: 10 }] });
      });

      it('« Changer la date » d’une réception en retard la reprogramme : même réception, mêmes lignes, nouvelle date', async () => {
        const { tap, type, sent } = await ouvre(`/admin/achats/${uuid(1)}/fiche`, [enDeuxFois()], suivi());
        await tap(`.reception[data-id="${uuid(701)}"] button.reschedule`);
        await type(`.reception[data-id="${uuid(701)}"] input[name=newDate]`, '2026-11-22');
        await tap(`.reception[data-id="${uuid(701)}"] button.save-date`);

        const request = await sent('PUT', `/api/v1/orders/${uuid(1)}/receptions/${uuid(701)}`);
        expect(request.request.body).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), plannedOn: '2026-11-22', lines: [{ orderLineId: uuid(11), quantity: 10 }] });
      });

      it('« Retirer » une réception prévue', async () => {
        const { tap, sent } = await ouvre(`/admin/achats/${uuid(1)}/fiche`, [enDeuxFois()], suivi());
        await tap(`.reception[data-id="${uuid(702)}"] button.withdraw`);
        expect((await sent('POST', `/api/v1/orders/${uuid(1)}/receptions/${uuid(702)}/withdraw`)).request.body).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/) });
      });

      it('l’accueil « À traiter » : chaque réception en retard alerte, et mène à sa commande pour la reprogrammer ; sans retard, rien à traiter', async () => {
        const { all, element } = await ouvre('/admin/accueil', [enDeuxFois()], suivi());
        expect(all('.todo .late-reception').map(text)).toEqual([expect.stringMatching(/Réception en retard.*Sedima.*15\/11\/2026.*4 sacs Aliment/)]);
        expect(element().querySelector('.todo .late-reception a')?.getAttribute('href')).toBe(`/admin/achats/${uuid(1)}/fiche`);
        expect(element().querySelector('.nothing')).toBeNull();
      });

      it('sans réception en retard, l’accueil dit qu’il n’y a rien à traiter', async () => {
        const { element } = await ouvre('/admin/accueil', [enDeuxFois()], { today: '2026-11-20', receptions: [suivi().receptions[1]!] });
        expect(element().querySelectorAll('.late-reception')).toHaveLength(0);
        expect(text(element().querySelector('.nothing'))).toBe('Rien à traiter pour l’instant.');
      });

      it('« À recevoir » : les réceptions prévues pas encore reçues, en retard d’abord en rouge, puis aujourd’hui, puis à venir ; chacune mène à sa commande', async () => {
        // A reception already received has nothing to receive any more: it is not listed
        const recue = { receptionId: uuid(703), orderId: uuid(1), supplierId: SEDIMA, campaignId: BANDE, plannedOn: '2026-11-12', previousDates: [], state: 'Received' as const, lines: [{ orderLineId: uuid(12), costTypeId: POUSSINS, expected: 1000, received: 1000, remaining: 0 }] };
        const { all, element } = await ouvre('/admin/achats/a-recevoir', [enDeuxFois()], { ...suivi(), receptions: [recue, ...suivi().receptions] });
        expect(all('.to-receive').map((node) => node.className.match(/late|today|coming/)?.[0])).toEqual(['late', 'coming']);
        expect(text(all('.to-receive')[0])).toMatch(/Sedima.*15\/11\/2026.*En retard.*4 sacs.*Aliment/);
        expect(element().querySelector('.to-receive a')?.getAttribute('href')).toBe(`/admin/achats/${uuid(1)}/fiche`);
      });
    });

    it('sans commande, la page le dit', async () => {
      const { element } = await ouvre('/admin/achats', []);

      expect(text(element().querySelector('.none'))).toContain('Aucune commande pour l’instant');
    });

    it('un brouillon s’annonce au gardien d’un geste — « Prévenir le gardien », tout en une fois —, et la liste est relue', async () => {
      const { tap, sent, all, soon } = await ouvre('/admin/achats');
      expect(text(all('.order .announce')[0])).toBe('Prévenir le gardien');

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

    // Spec: backlog Q.15 — prévenir en une fois, ou déclarer des réceptions (décisions du fondateur du 2026-11-14)
    it('un brouillon offre aussi « Déclarer des réceptions » : la fiche, son formulaire de réception ouvert', async () => {
      const { all } = await ouvre('/admin/achats');

      const declare = all('.order a.declare')[0];
      expect(text(declare)).toBe('Déclarer des réceptions');
      expect(declare?.getAttribute('href')).toBe(`/admin/achats/${uuid(1)}/fiche?receptions=declarer`);
    });

    it('seul un brouillon offre les deux gestes : une commande annoncée — en une fois ou en plusieurs — ne les propose plus', async () => {
      const { all } = await ouvre('/admin/achats', [uneCommande({ status: 'Announced' })]);

      expect(all('.order .announce')).toHaveLength(0);
      expect(all('.order a.declare')).toHaveLength(0);
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

      expect(all('.line:first-child .type-choice').map(text)).toEqual(['Aliment', 'Poussins', 'Aliment au kg']);
      await tap('.line:first-child .type-choice input[value="' + ALIMENT + '"]');
      await type('.line:first-child input[name=quantity]', '20');
      await type('.line:first-child input[name=unitPrice]', '17500');
      expect(text(element().querySelector('.total'))).toContain('350 000 FCFA');

      await tap('button.add-line');
      await tap('.line:nth-child(2) .type-choice input[value="' + POUSSINS + '"]');
      await type('.line:nth-child(2) input[name=quantity]', '1000');
      await type('.line:nth-child(2) input[name=unitPrice]', '550');
      // 20 × 17 500 + 1 000 × 550 = 900 000 FCFA
      expect(text(element().querySelector('.total'))).toContain('900 000 FCFA');
    });

    // Spec: backlog N.5 (décisions du fondateur du 2026-11-13) — le catalogue propose, il n'impose rien
    it('le prix se propose dès qu’on choisit l’article : le dernier payé à ce fournisseur, sinon le dernier de l’article ; jamais 0 pour un article jamais payé', async () => {
      const { tap, element } = await ouvre('/admin/achats/nouvelle');
      const prix = (line: string) => element().querySelector<HTMLInputElement>(`${line} input[name=unitPrice]`)?.value;

      await tap('input[name=supplier][value="' + SEDIMA + '"]');
      await tap('.line:first-child .type-choice input[value="' + ALIMENT + '"]');
      expect(prix('.line:first-child')).toBe('17 500');

      await tap('button.add-line');
      await tap('.line:nth-child(2) .type-choice input[value="' + POUSSINS + '"]');
      expect(prix('.line:nth-child(2)')).toBe('');
    });

    it('l’article choisi avant le fournisseur : le prix proposé suit le fournisseur choisi ensuite', async () => {
      const { tap, element } = await ouvre('/admin/achats/nouvelle');
      const prix = () => element().querySelector<HTMLInputElement>('.line:first-child input[name=unitPrice]')?.value;

      await tap('.line:first-child .type-choice input[value="' + ALIMENT + '"]');
      expect(prix()).toBe('16 000');
      await tap('input[name=supplier][value="' + SEDIMA + '"]');
      expect(prix()).toBe('17 500');
    });

    it('chez un fournisseur qui ne l’a jamais vendu, le dernier prix de l’article ; un prix tapé n’est jamais remplacé', async () => {
      const { tap, type, element } = await ouvre('/admin/achats/nouvelle');
      const prix = () => element().querySelector<HTMLInputElement>('.line:first-child input[name=unitPrice]')?.value;

      await tap('.line:first-child .type-choice input[value="' + ALIMENT + '"]');
      // Sans fournisseur choisi : le dernier prix de l'article, chez Touba le 1er novembre
      expect(prix()).toBe('16 000');
      await type('.line:first-child input[name=unitPrice]', '15000');
      await tap('input[name=supplier][value="' + SEDIMA + '"]');
      expect(prix()).toBe('15 000');
    });

    it('« Prix habituels » : chaque article dit le prix proposé, ou « pas encore de prix » ; l’admin en fixe un pour tous les fournisseurs', async () => {
      const { element, type, tap, sent, answerReadings, refresh } = await ouvre('/admin/plus/prix');
      const ligne = (id: string) => text(element().querySelector(`.article[data-type="${id}"]`));

      expect(ligne(ALIMENT)).toContain('proposé : 16 000');
      expect(ligne(POUSSINS)).toContain('pas encore de prix');
      expect(element().querySelector('.article[data-type="' + uuid(43) + '"]')).toBeNull();

      await type(`.article[data-type="${POUSSINS}"] input.price`, '450');
      await tap(`.article[data-type="${POUSSINS}"] button.set`);
      const fixe = await sent('POST', '/api/v1/price-catalog');
      expect(fixe.request.body).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), costTypeId: POUSSINS, supplierId: null, unitPrice: 450 });
      fixe.flush(null, { status: 204, statusText: 'No Content' });
      await refresh();
      answerReadings();
      await refresh();
      expect(element().querySelector<HTMLInputElement>(`.article[data-type="${POUSSINS}"] input.price`)?.value).toBe('');
    });

    // Spec: backlog Q.10 (demande du fondateur du 2026-11-13) — un montant se lit en le tapant, et l'unité est collée à sa case
    it('les nombres s’écrivent avec l’espace des milliers ; « sacs », « poussins » et la devise sont collés à leur case : impossible d’inverser prix et quantité', async () => {
      const { tap, type, element } = await ouvre('/admin/achats/nouvelle');
      await tap('.line:first-child .type-choice input[value="' + ALIMENT + '"]');
      await type('.line:first-child input[name=quantity]', '20');
      await type('.line:first-child input[name=unitPrice]', '17500');
      await tap('button.add-line');
      await tap('.line:nth-child(2) .type-choice input[value="' + POUSSINS + '"]');

      expect(element().querySelector<HTMLInputElement>('.line:first-child input[name=unitPrice]')?.value).toBe('17 500');
      const affixes = (line: string) => Array.from(element().querySelectorAll(`${line} .affix`)).map((affix) => affix.textContent?.trim());
      expect(affixes('.line:first-child')).toEqual(['sacs', 'FCFA']);
      expect(affixes('.line:nth-child(2)')).toEqual(['poussins', 'FCFA']);
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

    // Spec: backlog Q.13 — la relecture qui attrape les inversions
    it('sous chaque ligne, la phrase entière : quantité × prix = total', async () => {
      const { tap, type, element } = await ouvre('/admin/achats/nouvelle');
      await tap('.line:first-child .type-choice input[value="' + ALIMENT + '"]');
      await type('.line:first-child input[name=quantity]', '20');
      await type('.line:first-child input[name=unitPrice]', '17500');

      expect(text(element().querySelector('.line:first-child .line-readback'))).toBe('20 sacs × 17 500 FCFA = 350 000 FCFA');
      expect(element().querySelector('.line:first-child .price-warning')).toBeNull();
    });

    it('un prix trois fois loin du prix habituel avertit — quantité et prix inversés ? — sans rien bloquer', async () => {
      const { tap, type, element, sent } = await ouvre('/admin/achats/nouvelle');
      await tap('input[name=supplier][value="' + SEDIMA + '"]');
      await tap('.line:first-child .type-choice input[value="' + ALIMENT + '"]');
      await type('.line:first-child input[name=quantity]', '17500');
      await type('.line:first-child input[name=unitPrice]', '20');

      expect(text(element().querySelector('.line:first-child .price-warning'))).toBe('20 FCFA le sac, d’habitude 17 500 FCFA : quantité et prix inversés ?');
      await tap('form button[type=submit]');
      expect((await sent('POST', '/api/v1/orders')).request.body).toMatchObject({ lines: [{ quantity: 17_500, unitPrice: 20 }] });
    });

    // Spec: backlog N.8c — « Sac de 50 kg · changer » (décisions du fondateur du 2026-11-13)
    describe('le poids d’un sac d’aliment', () => {
      const poidsDit = (element: () => HTMLElement, line: string) => text(element().querySelector(`${line} .bag-weight`));

      it('une ligne d’aliment dit le poids de son sac, discrètement ; elle part sans poids écrit : le serveur recopie le poids habituel', async () => {
        const { tap, type, sent, element } = await ouvre('/admin/achats/nouvelle');
        await tap('input[name=supplier][value="' + SEDIMA + '"]');
        await tap('.line:first-child .type-choice input[value="' + ALIMENT + '"]');
        expect(poidsDit(element, '.line:first-child')).toContain('Sac de 50 kg');
        expect(element().querySelector('.line:first-child input[name=bagWeight]')).toBeNull();

        await type('.line:first-child input[name=quantity]', '20');
        await tap('form button[type=submit]');
        const request = await sent('POST', '/api/v1/orders');
        expect((request.request.body as DraftOrderRequest).lines[0]).not.toHaveProperty('bagWeight');
      });

      it('« changer » ouvre la case des kg : un sac de 40 kg part à 40 000 g', async () => {
        const { tap, type, sent } = await ouvre('/admin/achats/nouvelle');
        await tap('input[name=supplier][value="' + SEDIMA + '"]');
        await tap('.line:first-child .type-choice input[value="' + ALIMENT + '"]');
        await tap('.line:first-child .bag-weight button');
        await type('.line:first-child input[name=bagWeight]', '40');
        await type('.line:first-child input[name=quantity]', '2');
        await tap('form button[type=submit]');

        const request = await sent('POST', '/api/v1/orders');
        expect((request.request.body as DraftOrderRequest).lines[0]?.bagWeight).toBe(40_000);
      });

      it('Aliment au kg demande le poids tout de suite, et compte un seul sac : on écrit le prix total', async () => {
        const { tap, type, sent, element } = await ouvre('/admin/achats/nouvelle');
        await tap('input[name=supplier][value="' + SEDIMA + '"]');
        await tap('.line:first-child .type-choice input[value="' + AU_KG + '"]');
        expect(element().querySelector('.line:first-child input[name=bagWeight]')).not.toBeNull();
        expect(element().querySelector<HTMLInputElement>('.line:first-child input[name=quantity]')?.value).toBe('1');

        await type('.line:first-child input[name=bagWeight]', '15');
        await type('.line:first-child input[name=unitPrice]', '7500');
        await tap('form button[type=submit]');
        const request = await sent('POST', '/api/v1/orders');
        expect((request.request.body as DraftOrderRequest).lines[0]).toMatchObject({ costTypeId: AU_KG, quantity: 1, unitPrice: 7_500, bagWeight: 15_000 });
      });

      it('une ligne qui n’est pas de l’aliment ne parle pas de poids', async () => {
        const { tap, element } = await ouvre('/admin/achats/nouvelle');
        await tap('.line:first-child .type-choice input[value="' + POUSSINS + '"]');
        expect(element().querySelector('.line:first-child .bag-weight')).toBeNull();
      });

      it('un brouillon rouvert garde le poids écrit pour lui : 40 kg', async () => {
        const { element } = await ouvre('/admin/achats/' + uuid(1), [uneCommande({ lines: [{ id: uuid(11), costTypeId: ALIMENT, quantity: 2, unitPrice: 16_000, bagWeight: 40_000, received: 0 }] })]);
        expect(element().querySelector<HTMLInputElement>('.line:first-child input[name=bagWeight]')?.value).toBe('40');
      });
    });

    // Spec: backlog N.8a — un aliment sans poids habituel ne part pas sans son poids
    it('Aliment au kg, sans poids de sac : la règle du domaine refuse avant tout envoi, et le dit', async () => {
      const { tap, type, element } = await ouvre('/admin/achats/nouvelle');

      await tap('input[name=supplier][value="' + SEDIMA + '"]');
      await tap('.line:first-child .type-choice input[value="' + AU_KG + '"]');
      await type('.line:first-child input[name=quantity]', '1');
      await type('.line:first-child input[name=unitPrice]', '7500');
      await tap('form button[type=submit]');

      expect(text(element().querySelector('.refusal'))).toContain('Dis le poids du sac de cet aliment');
      expect(http.match((request) => request.method === 'POST')).toEqual([]);
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

    it('un fournisseur se crée sur place : son nom, son visage — Aliment, Poussins ou Véto seulement — ; il est aussitôt choisi', async () => {
      const { tap, type, sent, element, soon } = await ouvre('/admin/achats/nouvelle');

      await tap('.supplier.new input');
      // Demande du fondateur du 2026-11-13 : ce que l'élevage commande, rien d'autre
      expect(Array.from(element().querySelectorAll('.faces label')).map(text)).toEqual(['Aliment', 'Poussins', 'Véto']);
      await type('input[name=supplierName]', 'Senegal Aliment');
      await tap('.faces input[value=closed-bag]');
      await tap('button.create-supplier');

      const request = await sent('POST', '/api/v1/counterparties');
      expect(request.request.body).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), kind: 'Supplier', name: 'Senegal Aliment', face: 'closed-bag' });
      request.flush(null, { status: 201, statusText: 'Created' });
      await soon(() => expect(text(element().querySelector('input[name=supplier]:checked')?.closest('label'))).toBe('Senegal Aliment'));
    });

    it('un brouillon se rouvre tel qu’il est écrit, et « Enregistrer » le réécrit', async () => {
      const { element, tap, sent } = await ouvre(`/admin/achats/${uuid(1)}`);

      expect(element().querySelector<HTMLInputElement>('input[name=supplier]:checked')?.value).toBe(SEDIMA);
      expect(Array.from(element().querySelectorAll<HTMLInputElement>('input[name=quantity]')).map((input) => input.value)).toEqual(['20', '1 000']);
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
    // The order of 12/10, received whole: 20 × 17 500 + 1 000 × 550 = 900 000 FCFA to pay; 400 000 FCFA paid by Wave on 13/10.
    const recue = (fields: Partial<OrderView> = {}) =>
      uneCommande({
        status: 'Received',
        billable: 900_000,
        paid: 400_000,
        payments: [{ id: uuid(501), paidOn: '2026-10-13', amount: 400_000, method: 'Wave', paidBy: null, attachments: [] }],
        lines: [
          { id: uuid(11), costTypeId: ALIMENT, quantity: 20, unitPrice: 17_500, bagWeight: null, received: 20 },
          { id: uuid(12), costTypeId: POUSSINS, quantity: 1000, unitPrice: 550, bagWeight: null, received: 1000 },
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
      expect(text(element().querySelector('.balance'))).toMatch(/À payer 900 000 FCFA.*Déjà payé 400 000 FCFA.*Reste à payer 500 000 F/);
      expect(all('.paid-list li').map(text)).toEqual(['13/10/2026 Wave 400 000 FCFA']);
    });

    it('le montant proposé est le reste à payer, la date celle du jour ; aucun moyen n’est choisi pour l’admin', async () => {
      const { element, all } = await ouvre(PAGE, [recue()]);

      expect(element().querySelector<HTMLInputElement>('input[name=amount]')?.value).toBe('500 000');
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
      expect(refus()).toContain('Un montant en francs entiers, d’au moins 1 FCFA');
      await type('input[name=amount]', '99.5');
      await tap('form .go');
      expect(refus()).toContain('Un montant en francs entiers, d’au moins 1 FCFA');
      expect(http.match((request) => request.method === 'POST')).toEqual([]);
    });

    it('rien de reçu encore : aucun montant proposé, et la page dit que ce paiement est une avance', async () => {
      const { element } = await ouvre(PAGE, [uneCommande({ status: 'Announced' })]);

      expect(text(element().querySelector('.balance'))).toContain('Rien de reçu encore : ce paiement est une avance');
      expect(element().querySelector<HTMLInputElement>('input[name=amount]')?.value).toBe('');
    });

    it('payé plus que le facturable : la page dit que le fournisseur doit à l’élevage', async () => {
      const { element } = await ouvre(PAGE, [recue({ paid: 950_000, payments: [{ id: uuid(501), paidOn: '2026-10-13', amount: 950_000, method: 'Cash', paidBy: null, attachments: [] }] })]);

      expect(text(element().querySelector('.balance'))).toContain('Sedima te doit 50 000 FCFA');
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
    it('« Plus de détails » : payé par quelqu’un d’autre — les tiers qui peuvent avancer des frais (R.7), jamais le fournisseur de la commande', async () => {
      const { all, element } = await ouvre(PAGE, [recue()]);

      expect(text(element().querySelector('.payer-more summary'))).toBe('Plus de détails : payé par quelqu’un d’autre');
      // Touba Avicole n'avance pas de frais : seul le Ramasseur est proposé (demande du fondateur du 2026-11-13)
      expect(all('.payer').map(text)).toEqual(['Ramasseur']);
    });

    it('payée par l’acheteur, par Wave, ses frais à ta charge : le paiement nomme qui a payé ; les frais partent « payés par » lui', async () => {
      const { tap, type, sent, element } = await ouvre(PAGE, [recue()]);

      await tap('.payer:nth-child(1)');
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

      await tap('.payer:nth-child(1)');
      await tap('.method-cash input');
      expect(element().querySelector('input[name=fee]')).toBeNull();
    });

    it('un paiement déjà fait par un tiers le dit dans la liste', async () => {
      const { all } = await ouvre(PAGE, [recue({ payments: [{ id: uuid(501), paidOn: '2026-10-13', amount: 400_000, method: 'Wave', paidBy: uuid(34), attachments: [] }] })]);

      expect(all('.paid-list li').map(text)).toEqual(['13/10/2026 Wave, payé par Ramasseur 400 000 FCFA']);
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
