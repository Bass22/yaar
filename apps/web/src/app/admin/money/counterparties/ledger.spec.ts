import { provideHttpClient } from '@angular/common/http';
import { IDBFactory } from 'fake-indexeddb';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { CaretakerCampaign, CaretakerContext, CostTypeView, CounterpartyView, LedgerView } from '@contracts';
import { provideHeardVoice } from '../../../core/audio/testing';
import { CLOCK } from '../../../core/clock';
import { OfficeQueue } from '../../../core/outbox/office-queue';
import { OFFICE_QUEUE } from '../../office-sync';
import { adminRoutes } from '../../admin.routes';

// Spec: backlog R.3 — l'écran « Qui doit quoi » ; cahier des charges « Le grand livre » (2026-11-12) ;
// bureau-admin-v2.html, écrans 5 et 10 (le sens se voit sans lire : flèche rouge de toi vers le
// tiers, verte vers toi ; le visage du tiers ; le montant en billets). L'écran n'additionne rien.

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT = uuid(10);
const LE_GERANT = uuid(54);
const NORD = uuid(3);
const SEDIMA = uuid(31);
const OUSMANE = uuid(32);
const RAMASSEUR = uuid(33);
const token = `e30.${btoa(JSON.stringify({ sub: LE_GERANT, tenant: TENANT })).replace(/=+$/, '')}.c2ln`;
const NOW = new Date('2026-11-12T08:00:00.000Z');
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// The running flocks, none unless a test places some: a settlement belongs to none of them (P.8).
let lots: CaretakerCampaign[] = [];
const bande = (rank: number, campaignDay: number): CaretakerCampaign => ({ campaignId: uuid(rank), placementDay: '2026-10-01', campaignDay, liveCount: 1000, journal: [], deliveries: [], weighingRequests: [], strain: 'Cobb500' });
const contexte = (): CaretakerContext => ({ chef: null, sites: [{ siteId: NORD, name: 'Poulailler Nord', timeZone: 'Africa/Dakar', today: '2026-11-12', primaryCaretakerId: null, campaigns: lots }] });
// The farm's « Frais financiers » type: what a Wave or Orange Money fee is written as (P.8).
const FRAIS = uuid(45);
const types = (): CostTypeView[] => [{ id: FRAIS, category: 'FinancialCharges', name: 'Frais financiers', behaviour: 'Fixed', bagWeight: null, orderable: false, archived: false }];
const tiers = (): CounterpartyView[] => [
  { id: SEDIMA, kind: 'Supplier', name: 'Sedima', face: 'closed-bag', advancesExpenses: false, archived: false },
  { id: OUSMANE, kind: 'Collaborator', name: 'Ousmane', face: 'caretaker', advancesExpenses: false, archived: false },
  { id: RAMASSEUR, kind: 'Customer', name: 'Ramasseur', face: 'hen', advancesExpenses: false, archived: false },
  // A counterparty without any entry yet: not in the ledger, still reachable (R.7)
  { id: uuid(37), kind: 'Collaborator', name: 'Amy Sow', face: 'caretaker', advancesExpenses: false, archived: false },
];
// You owe Ousmane 45 000 FCFA and Sedima 40 000 FCFA; the Ramasseur owes you 10 000 FCFA; nobody else.
const livre = (fields: Partial<LedgerView> = {}): LedgerView => ({
  currency: 'XOF',
  youOwe: 85_000,
  owedToYou: 10_000,
  counterparties: [
    { counterpartyId: OUSMANE, balance: -45_000, entries: [{ on: '2026-11-10', amount: -45_000, source: { kind: 'Cost', costId: uuid(301) } }] },
    {
      counterpartyId: SEDIMA,
      balance: -40_000,
      entries: [
        { on: '2026-10-12', amount: -140_000, source: { kind: 'OrderReceived', orderId: uuid(20) } },
        { on: '2026-10-13', amount: 100_000, source: { kind: 'OrderPayment', orderId: uuid(20), method: 'Wave' } },
      ],
    },
    { counterpartyId: RAMASSEUR, balance: 10_000, entries: [{ on: '2026-11-11', amount: 10_000, source: { kind: 'Settlement', method: 'Cash', direction: 'ToCounterparty' } }] },
    { counterpartyId: uuid(36), balance: 0, entries: [] },
  ],
  ...fields,
});
const RECORDED = ['ledger-you-owe', 'ledger-owes-you', 'ledger-settled', 'ledger-total-you-owe', 'ledger-total-owed-to-you', 'settle-to', 'settle-from', 'money-francs', 'number-and', 'number-1000', ...Array.from({ length: 101 }, (_, value) => `number-${value}`)];

describe('« Qui doit quoi », au bureau', () => {
  let http: HttpTestingController;
  let heard: string[][];

  const ouvre = async (url: string, ledger: LedgerView = livre()) => {
    const voice = provideHeardVoice(RECORDED);
    heard = voice.heard;
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([{ path: 'admin', children: adminRoutes }]), { provide: CLOCK, useValue: { now: () => NOW } }, { provide: OFFICE_QUEUE, useFactory: () => OfficeQueue.open(new IDBFactory()) }, ...voice.providers],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    const refresh = async () => {
      await settle();
      http.match('/api/v1/caretaker/context').forEach((request) => request.flush(contexte()));
      http.match('/api/v1/orders').forEach((request) => request.flush([]));
      http.match({ method: 'GET', url: '/api/v1/counterparties' }).forEach((request) => request.flush(tiers()));
      http.match('/api/v1/cost-types').forEach((request) => request.flush(types()));
      http.match('/api/v1/reference-data').forEach((request) => request.flush({ currency: 'XOF', costCategories: [], lossTypes: [], strains: [] }));
      http.match('/api/v1/ledger').forEach((request) => request.flush(ledger));
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
    const sent = () => {
      let found: TestRequest | undefined;
      return vi
        .waitFor(async () => {
          await refresh();
          found = http.match((request) => request.method === 'POST' && request.url === '/api/v1/settlements')[0] ?? found;
          expect(found).toBeDefined();
        })
        .then(() => found as TestRequest);
    };
    return { element, all, tap, type, sent, refresh };
  };
  const text = (node: Element | null | undefined) => node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  beforeEach(() => {
    lots = [];
    localStorage.clear();
    localStorage.setItem('yaar.session', JSON.stringify({ token, expiresAt: '2099-01-01T00:00:00.000Z', role: 'admin', account: { name: 'Bassirou', avatar: 'baobab', language: 'fr' } }));
  });

  describe('la liste', () => {
    it("l'onglet Tiers ouvre « Qui doit quoi » : en tête, ce que tu dois et ce qu'on te doit, venus du serveur", async () => {
      const { all } = await ouvre('/admin/tiers');

      expect(all('.totals .total').map(text)).toEqual([expect.stringContaining('Tu dois 85 000 FCFA'), expect.stringContaining('On te doit 10 000 FCFA')]);
    });

    it('chaque tiers dit son sens sans lire : flèche rouge et « tu dois », flèche verte et « il te doit » ; son visage, son nom, le montant en billets', async () => {
      const { all } = await ouvre('/admin/tiers');

      const [ousmane, sedima, ramasseur] = all('.line');
      expect([ousmane?.className.match(/you-owe|owed|settled/)?.[0], text(ousmane?.querySelector('.arrow')), text(ousmane?.querySelector('.sense')), text(ousmane?.querySelector('.amount'))]).toEqual(['you-owe', '→', 'tu dois', '45 000 FCFA']);
      expect([ramasseur?.className.match(/you-owe|owed|settled/)?.[0], text(ramasseur?.querySelector('.arrow')), text(ramasseur?.querySelector('.sense'))]).toEqual(['owed', '←', 'il te doit']);
      expect(text(sedima?.querySelector('.who'))).toBe('Sedima');
      expect(sedima?.querySelector('.face use')?.getAttribute('href')).toContain('closed-bag');
      expect(ousmane?.querySelectorAll('app-banknotes .note').length).toBe(5);
    });

    // Spec: backlog R.8 — « payé d'avance »
    it('un fournisseur payé avant de livrer ne « doit » pas : « payé d’avance, à livrer » ; payé d’avance en partie, la part le dit', async () => {
      const toutAvance = { counterpartyId: SEDIMA, balance: 180_000, paidAhead: 180_000, entries: [] };
      const enPartie = { counterpartyId: RAMASSEUR, balance: 200_000, paidAhead: 180_000, entries: [] };
      const { all } = await ouvre('/admin/tiers', livre({ counterparties: [toutAvance, enPartie] }));

      const [sedima, ramasseur] = all('.line');
      expect(text(sedima?.querySelector('.sense'))).toBe('payé d’avance, à livrer');
      expect(sedima?.querySelector('.ahead')).toBeNull();
      expect(text(ramasseur?.querySelector('.sense'))).toBe('il te doit');
      expect(text(ramasseur?.querySelector('.ahead'))).toBe('dont 180 000 FCFA payés d’avance, à livrer');
    });

    it('sur la fiche du fournisseur payé d’avance, le même mot', async () => {
      const { element } = await ouvre(`/admin/tiers/${SEDIMA}`, livre({ counterparties: [{ counterpartyId: SEDIMA, balance: 180_000, paidAhead: 180_000, entries: [] }] }));
      expect(text(element().querySelector('.balance .sense'))).toBe('Payé d’avance, à livrer');
    });

    it('un tiers soldé ne porte ni flèche ni montant : « soldé »', async () => {
      const { all } = await ouvre('/admin/tiers');

      const settled = all('.line')[3];
      expect([settled?.querySelector('.arrow'), settled?.querySelector('.amount'), text(settled?.querySelector('.sense'))]).toEqual([null, null, 'soldé']);
    });

    it('la voix dit le sens, puis le montant', async () => {
      const { tap } = await ouvre('/admin/tiers');

      await tap('.line .listen button');
      await vi.waitFor(() => expect(heard.flat()).toEqual(expect.arrayContaining(['fr/ledger-you-owe', 'fr/money-francs'])));
    });

    it('toucher une ligne ouvre le grand livre du tiers', async () => {
      const { tap } = await ouvre('/admin/tiers');

      await tap('.line:nth-child(2) .open');
      expect(TestBed.inject(Router).url).toBe(`/admin/tiers/${SEDIMA}`);
    });
  });

  describe('le grand livre d’un tiers, et régler', () => {
    it('son solde, et chaque écriture datée dans les deux sens', async () => {
      const { element, all } = await ouvre(`/admin/tiers/${SEDIMA}`);

      expect(text(element().querySelector('.balance'))).toContain('Tu dois 40 000 FCFA');
      expect(all('.entries li').map(text)).toEqual(['12/10/2026 Commande reçue − 140 000 FCFA', '13/10/2026 Paiement de commande + 100 000 FCFA']);
    });

    it('régler propose la dette, la date du jour, « tu lui as donné » ; le moyen n’est jamais choisi d’avance', async () => {
      const { element, all } = await ouvre(`/admin/tiers/${OUSMANE}`);

      expect(element().querySelector<HTMLInputElement>('input[name=amount]')?.value).toBe('45 000');
      expect(element().querySelector<HTMLInputElement>('input[name=paidOn]')?.value).toBe('2026-11-12');
      expect(text(element().querySelector('.direction .choice.on'))).toContain('Tu lui as donné');
      expect(all('.method input').filter((input) => (input as HTMLInputElement).checked)).toEqual([]);
    });

    it('un tiers qui te doit : le sens proposé est « il t’a donné »', async () => {
      const { element } = await ouvre(`/admin/tiers/${RAMASSEUR}`);

      expect(text(element().querySelector('.direction .choice.on'))).toContain('Il t’a donné');
    });

    it('« Régler » envoie un règlement partiel, avec un identifiant créé ici, puis relit le grand livre ; la voix le dit', async () => {
      const { tap, type, sent } = await ouvre(`/admin/tiers/${OUSMANE}`);

      await type('input[name=amount]', '20000');
      await tap('.method-orange input');
      await tap('.go');
      const request = await sent();

      expect(request.request.body).toEqual({ id: expect.stringMatching(UUID), counterpartyId: OUSMANE, paidOn: '2026-11-12', amount: 20_000, method: 'OrangeMoney', direction: 'ToCounterparty' });
      request.flush(null, { status: 201, statusText: 'Created' });
      await vi.waitFor(() => expect(heard.flat()).toContain('fr/settle-to'));
    });

    // Demande du fondateur du 2026-11-13 : on paie rarement un seul tiers ; la vue d'ensemble revient
    it('après le tampon « C’est noté » et la voix, l’écran revient à « Qui doit quoi »', async () => {
      const { tap, type, sent, element } = await ouvre(`/admin/tiers/${OUSMANE}`);

      await type('input[name=amount]', '20000');
      await tap('.method-orange input');
      await tap('.go');
      (await sent()).flush(null, { status: 201, statusText: 'Created' });
      await vi.waitFor(() => expect(element().querySelector('app-stamp')).not.toBeNull());
      expect(TestBed.inject(Router).url).toBe(`/admin/tiers/${OUSMANE}`);

      await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe('/admin/tiers'), { timeout: 3_000 });
    });

    // Spec: backlog P.8 — les frais Wave et Orange Money d'un règlement (décisions du 2026-11-12).
    it('par Wave, avec deux lots en cours : la case « Frais » et le choix du lot qui les porte, aucun choisi d’avance', async () => {
      lots = [bande(4, 30), bande(5, 9)];
      const { tap, element, all } = await ouvre(`/admin/tiers/${OUSMANE}`);

      await tap('.method-wave input');
      expect(element().querySelector('input[name=fee]')).not.toBeNull();
      expect(all('.fee-lot').map(text)).toEqual(['Poulailler Nord · Jour 30', 'Poulailler Nord · Jour 9']);
    });

    it('sans lot en cours, aucune case « Frais » : rien ne pourrait les porter', async () => {
      const { tap, element } = await ouvre(`/admin/tiers/${OUSMANE}`);

      await tap('.method-wave input');
      expect(element().querySelector('input[name=fee]')).toBeNull();
    });

    it('des frais avec plusieurs lots : il faut choisir le lot ; puis le règlement garde son montant, et les frais partent comme une dépense payée de ce lot', async () => {
      lots = [bande(4, 30), bande(5, 9)];
      const { tap, type, sent, element } = await ouvre(`/admin/tiers/${OUSMANE}`);
      await type('input[name=amount]', '20000');
      await tap('.method-wave input');
      await type('input[name=fee]', '200');

      await tap('.go');
      expect(text(element().querySelector('.refusal'))).toContain('Choisis le lot qui porte les frais');

      await tap('.fee-lot:nth-of-type(2) input');
      await tap('.go');
      const settlement = await sent();
      expect(settlement.request.body).toEqual(expect.objectContaining({ amount: 20_000, method: 'Wave' }));
      settlement.flush(null, { status: 201, statusText: 'Created' });
      let fee: TestRequest | undefined;
      await vi.waitFor(() => {
        fee = http.match((request) => request.method === 'POST' && request.url === '/api/v1/costs')[0] ?? fee;
        expect(fee).toBeDefined();
      });
      expect(fee?.request.body).toEqual(expect.objectContaining({ campaignId: uuid(5), costTypeId: FRAIS, spentOn: '2026-11-12', amount: 200, note: 'Frais Wave — règlement Ousmane', payment: { kind: 'Paid' } }));
    });

    it('un seul lot en cours : il porte les frais d’office, sans choix à faire', async () => {
      lots = [bande(4, 30)];
      const { tap, type, sent, all } = await ouvre(`/admin/tiers/${OUSMANE}`);
      await type('input[name=amount]', '20000');
      await tap('.method-orange input');
      await type('input[name=fee]', '150');
      expect(all('.fee-lot')).toEqual([]);

      await tap('.go');
      (await sent()).flush(null, { status: 201, statusText: 'Created' });
      let fee: TestRequest | undefined;
      await vi.waitFor(() => {
        fee = http.match((request) => request.method === 'POST' && request.url === '/api/v1/costs')[0] ?? fee;
        expect(fee).toBeDefined();
      });
      expect(fee?.request.body).toEqual(expect.objectContaining({ campaignId: uuid(4), amount: 150, note: 'Frais Orange Money — règlement Ousmane' }));
    });

    it('la règle du domaine refuse avant tout envoi : sans moyen, un montant nul', async () => {
      const { tap, type, element } = await ouvre(`/admin/tiers/${OUSMANE}`);

      await tap('.go');
      expect(text(element().querySelector('.refusal'))).toContain('Choisis comment tu as réglé');
      await tap('.method-cash input');
      await type('input[name=amount]', '0');
      await tap('.go');
      expect(text(element().querySelector('.refusal'))).toContain('au moins 1 FCFA');
      expect(http.match((request) => request.method === 'POST')).toEqual([]);
    });

    // Spec: backlog P.7 — un règlement saisi sans réseau attend sur l'appareil et repart, une seule fois.
    it('sans réseau, le règlement est gardé et dit « en attente d’envoi » ; au retour du réseau, le même règlement repart', async () => {
      const { tap, sent, element, refresh } = await ouvre(`/admin/tiers/${OUSMANE}`);

      await tap('.method-wave input');
      await tap('.go');
      const first = await sent();
      first.error(new ProgressEvent('error'));
      await vi.waitFor(async () => {
        await refresh();
        expect(text(element().querySelector('app-office-pending li'))).toBe('Règlement de 45 000 FCFA en attente d’envoi');
      });

      globalThis.dispatchEvent(new Event('online'));
      const again = await sent();
      expect((again.request.body as { id: string }).id).toBe((first.request.body as { id: string }).id);
    });
  });

  // Spec: backlog R.7 — ajouter un tiers, et « peut avancer des frais » (demandes du fondateur du 2026-11-13)
  describe('ajouter un tiers', () => {
    const ecrit = (method: string, url: string) =>
      vi.waitFor(() => {
        const found = http.match((request) => request.method === method && request.url === url)[0];
        expect(found).toBeDefined();
        return found as TestRequest;
      });

    it('« Ajouter un tiers » : sa sorte, son nom, son visage dans une liste courte selon la sorte, et s’il peut avancer des frais', async () => {
      const { tap, type, all, refresh } = await ouvre('/admin/tiers');
      await tap('button.add-counterparty');

      expect(all('.kinds label').map(text)).toEqual(['Fournisseur', 'Acheteur', 'Collaborateur']);
      expect(all('.new-faces label').map(text)).toEqual(['Aliment', 'Poussins', 'Véto']);
      await tap('.kinds input[value=Customer]');
      expect(all('.new-faces label').map(text)).toEqual(['Une personne', 'Une entreprise']);
      await tap('.kinds input[value=Collaborator]');
      expect(all('.new-faces label').map(text)).toEqual(['Une personne']);

      await type('input[name=counterpartyName]', 'Amadou Ba');
      await tap('input[name=advancesExpenses]');
      await tap('button.create');
      await refresh();
      const request = await ecrit('POST', '/api/v1/counterparties');
      expect(request.request.body).toEqual({ id: expect.stringMatching(UUID), kind: 'Collaborator', name: 'Amadou Ba', face: 'caretaker', advancesExpenses: true });
    });

    it('un tiers sans écriture reste joignable, sous « Les autres tiers »', async () => {
      const { all } = await ouvre('/admin/tiers');
      expect(all('.others a').map(text)).toEqual(['Amy Sow']);
      expect(all('.others a')[0]?.getAttribute('href')).toBe(`/admin/tiers/${uuid(37)}`);
    });

    it('sur la fiche d’un tiers, « peut avancer des frais » se coche ou se décoche', async () => {
      const { tap, element, refresh } = await ouvre(`/admin/tiers/${uuid(37)}`);
      expect(element().querySelector<HTMLInputElement>('input[name=advancesExpenses]')?.checked).toBe(false);

      await tap('input[name=advancesExpenses]');
      await refresh();
      const coche = await ecrit('PATCH', `/api/v1/counterparties/${uuid(37)}`);
      expect(coche.request.body).toEqual({ advancesExpenses: true });
      coche.flush(null, { status: 204, statusText: 'No Content' });
      await vi.waitFor(async () => {
        await refresh();
        expect(element().querySelector<HTMLInputElement>('input[name=advancesExpenses]')?.checked).toBe(true);
      });

      // Décocher renvoie « non »
      await tap('input[name=advancesExpenses]');
      await refresh();
      expect((await ecrit('PATCH', `/api/v1/counterparties/${uuid(37)}`)).request.body).toEqual({ advancesExpenses: false });
    });
  });
});

