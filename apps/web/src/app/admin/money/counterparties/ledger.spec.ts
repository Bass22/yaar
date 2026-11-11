import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { CaretakerContext, CounterpartyView, LedgerView } from '@contracts';
import { provideHeardVoice } from '../../../core/audio/testing';
import { CLOCK } from '../../../core/clock';
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

const contexte = (): CaretakerContext => ({ chef: null, sites: [{ siteId: NORD, name: 'Poulailler Nord', timeZone: 'Africa/Dakar', today: '2026-11-12', primaryCaretakerId: null, campaigns: [] }] });
const tiers = (): CounterpartyView[] => [
  { id: SEDIMA, kind: 'Supplier', name: 'Sedima', face: 'closed-bag', archived: false },
  { id: OUSMANE, kind: 'Collaborator', name: 'Ousmane', face: 'caretaker', archived: false },
  { id: RAMASSEUR, kind: 'Customer', name: 'Ramasseur', face: 'hen', archived: false },
];
// You owe Ousmane 45 000 F and Sedima 40 000 F; the Ramasseur owes you 10 000 F; nobody else.
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
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([{ path: 'admin', children: adminRoutes }]), { provide: CLOCK, useValue: { now: () => NOW } }, ...voice.providers],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    const refresh = async () => {
      await settle();
      http.match('/api/v1/caretaker/context').forEach((request) => request.flush(contexte()));
      http.match('/api/v1/orders').forEach((request) => request.flush([]));
      http.match('/api/v1/counterparties').forEach((request) => request.flush(tiers()));
      http.match('/api/v1/cost-types').forEach((request) => request.flush([]));
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
    localStorage.clear();
    localStorage.setItem('yaar.session', JSON.stringify({ token, expiresAt: '2099-01-01T00:00:00.000Z', role: 'admin', account: { name: 'Bassirou', avatar: 'baobab', language: 'fr' } }));
  });

  describe('la liste', () => {
    it("l'onglet Tiers ouvre « Qui doit quoi » : en tête, ce que tu dois et ce qu'on te doit, venus du serveur", async () => {
      const { all } = await ouvre('/admin/tiers');

      expect(all('.totals .total').map(text)).toEqual([expect.stringContaining('Tu dois 85 000 F'), expect.stringContaining('On te doit 10 000 F')]);
    });

    it('chaque tiers dit son sens sans lire : flèche rouge et « tu dois », flèche verte et « il te doit » ; son visage, son nom, le montant en billets', async () => {
      const { all } = await ouvre('/admin/tiers');

      const [ousmane, sedima, ramasseur] = all('.line');
      expect([ousmane?.className.match(/you-owe|owed|settled/)?.[0], text(ousmane?.querySelector('.arrow')), text(ousmane?.querySelector('.sense')), text(ousmane?.querySelector('.amount'))]).toEqual(['you-owe', '→', 'tu dois', '45 000 F']);
      expect([ramasseur?.className.match(/you-owe|owed|settled/)?.[0], text(ramasseur?.querySelector('.arrow')), text(ramasseur?.querySelector('.sense'))]).toEqual(['owed', '←', 'il te doit']);
      expect(text(sedima?.querySelector('.who'))).toBe('Sedima');
      expect(sedima?.querySelector('.face use')?.getAttribute('href')).toContain('closed-bag');
      expect(ousmane?.querySelectorAll('app-banknotes .note').length).toBe(5);
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

      expect(text(element().querySelector('.balance'))).toContain('Tu dois 40 000 F');
      expect(all('.entries li').map(text)).toEqual(['12/10/2026 Commande reçue − 140 000 F', '13/10/2026 Paiement de commande + 100 000 F']);
    });

    it('régler propose la dette, la date du jour, « tu lui as donné » ; le moyen n’est jamais choisi d’avance', async () => {
      const { element, all } = await ouvre(`/admin/tiers/${OUSMANE}`);

      expect(element().querySelector<HTMLInputElement>('input[name=amount]')?.value).toBe('45000');
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

    it('la règle du domaine refuse avant tout envoi : sans moyen, un montant nul', async () => {
      const { tap, type, element } = await ouvre(`/admin/tiers/${OUSMANE}`);

      await tap('.go');
      expect(text(element().querySelector('.refusal'))).toContain('Choisis comment tu as réglé');
      await tap('.method-cash input');
      await type('input[name=amount]', '0');
      await tap('.go');
      expect(text(element().querySelector('.refusal'))).toContain('au moins 1 F');
      expect(http.match((request) => request.method === 'POST')).toEqual([]);
    });

    it('sans réseau, rien n’est réglé et il le dit ; réessayer renvoie le même règlement', async () => {
      const { tap, sent, element } = await ouvre(`/admin/tiers/${OUSMANE}`);

      await tap('.method-wave input');
      await tap('.go');
      const first = await sent();
      first.error(new ProgressEvent('error'));
      await vi.waitFor(() => expect(text(element().querySelector('.refusal'))).toContain('Pas de réseau'));

      await tap('.go');
      const again = await sent();
      expect((again.request.body as { id: string }).id).toBe((first.request.body as { id: string }).id);
    });
  });
});
