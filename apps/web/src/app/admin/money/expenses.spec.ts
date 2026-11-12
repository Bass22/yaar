import { provideHttpClient } from '@angular/common/http';
import { IDBFactory } from 'fake-indexeddb';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { CampaignMoneyView, CaretakerContext, CostView, CounterpartyView, CostTypeView } from '@contracts';
import { provideHeardVoice } from '../../core/audio/testing';
import { CLOCK } from '../../core/clock';
import { OfficeQueue } from '../../core/outbox/office-queue';
import { OFFICE_QUEUE, OfficeSync } from '../office-sync';
import { REDUCE_PHOTO } from '../../core/media/reduce-photo';
import { adminRoutes } from '../admin.routes';

// Spec: backlog P.4 — saisir et lire les dépenses ; P.5 — reçu en photo et duplication ; cahier des
// charges « Les dépenses » (décisions du 2026-11-12) ; bureau-admin-v2.html, écrans 7 à 9 (quoi →
// combien, en billets → relecture vocale → Oui). Aucun calcul d'argent dans l'écran : l'engagé et le
// coût par poulet viennent du serveur.

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT = uuid(10);
const LE_GERANT = uuid(54);
const NORD = uuid(3);
const BANDE = uuid(4);
const SALAIRE = uuid(43);
const EAU = uuid(44);
const OUSMANE = uuid(32);
const SEDIMA = uuid(31);
const token = `e30.${btoa(JSON.stringify({ sub: LE_GERANT, tenant: TENANT })).replace(/=+$/, '')}.c2ln`;
// Thursday November 12th, 2026, 08:00 in Dakar.
const NOW = new Date('2026-11-12T08:00:00.000Z');
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
const RECU = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9, 0xff, 0xd9]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const contexte = (): CaretakerContext => ({
  chef: null,
  sites: [{ siteId: NORD, name: 'Poulailler Nord', timeZone: 'Africa/Dakar', today: '2026-11-12', primaryCaretakerId: null, campaigns: [{ campaignId: BANDE, placementDay: '2026-11-01', campaignDay: 11, liveCount: 997, journal: [], deliveries: [], weighingRequests: [], strain: 'Cobb500' }] }],
});
const tiers = (): CounterpartyView[] => [
  { id: SEDIMA, kind: 'Supplier', name: 'Sedima', face: 'closed-bag', archived: false },
  { id: OUSMANE, kind: 'Collaborator', name: 'Ousmane', face: 'caretaker', archived: false },
  { id: uuid(33), kind: 'Customer', name: 'Ramasseur', face: 'hen', archived: false },
  { id: uuid(34), kind: 'Supplier', name: 'Ancien', face: 'truck', archived: true },
];
// The farm's « Frais financiers » type, only where a test needs it: the fees a payer's transfer cost (R.4).
const FRAIS = uuid(46);
let extraTypes: CostTypeView[] = [];
const types = (): CostTypeView[] => [
  ...extraTypes,
  { id: uuid(41), category: 'Feed', name: 'Aliment', behaviour: 'Variable', orderable: true, archived: false },
  { id: SALAIRE, category: 'Labour', name: 'Salaire du gardien', behaviour: 'Fixed', orderable: false, archived: false },
  { id: EAU, category: 'Utilities', name: 'Eau et électricité', behaviour: 'Variable', orderable: false, archived: false },
  { id: uuid(45), category: 'Processing', name: 'Déplumage', behaviour: 'Variable', orderable: false, archived: true },
];
const NOTE = 'Facture SDE d’octobre, payée au guichet de Thiès. Le compteur a été relevé par le gardien le 30, la facture suivante viendra en décembre — à vérifier avec le voisin qui partage la ligne.';
const eau = (fields: Partial<CostView> = {}): CostView => ({
  id: uuid(301),
  costTypeId: EAU,
  spentOn: '2026-11-10',
  amount: 12_500,
  note: NOTE,
  payment: { kind: 'Paid' },
  receipt: 'e'.repeat(64),
  history: [{ id: uuid(301), recordedAt: '2026-11-10T09:00:00.000Z', recordedBy: LE_GERANT, spentOn: '2026-11-10', amount: 12_500, payment: { kind: 'Paid' } }],
  ...fields,
});
const salaire = (): CostView => ({
  id: uuid(302),
  costTypeId: SALAIRE,
  spentOn: '2026-11-12',
  amount: 45_000,
  note: null,
  payment: { kind: 'ToPay', counterpartyId: OUSMANE },
  receipt: null,
  history: [{ id: uuid(302), recordedAt: '2026-11-12T07:00:00.000Z', recordedBy: LE_GERANT, spentOn: '2026-11-12', amount: 45_000, payment: { kind: 'ToPay', counterpartyId: OUSMANE } }],
});
const argent = (fields: Partial<CampaignMoneyView> = {}): CampaignMoneyView => ({ campaignId: BANDE, currency: 'XOF', committed: 957_500, liveCount: 997, costPerBird: 1030, costs: [eau(), salaire()], ...fields });
const RECORDED = ['cost-what', 'cost-how-much', 'cost-category-utilities', 'cost-category-labour', 'cost-category-feed', 'money-amount', 'money-francs', 'cost-paid', 'cost-to-pay', 'cost-paid-by-other', 'confirm', 'committed', 'cost-per-bird', 'cost-per-bird-unknown', 'written-thanks', 'number-100', 'number-1000', 'number-2000', 'number-12', 'number-42', 'number-500', 'number-30', 'number-957'];

describe('Les dépenses, au bureau', () => {
  let http: HttpTestingController;
  let heard: string[][];

  const ouvre = async (url: string, money: CampaignMoneyView = argent()) => {
    const voice = provideHeardVoice(RECORDED);
    heard = voice.heard;
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: 'admin', children: adminRoutes }]),
        { provide: CLOCK, useValue: { now: () => NOW } }, { provide: OFFICE_QUEUE, useFactory: () => OfficeQueue.open(new IDBFactory()) },
        { provide: REDUCE_PHOTO, useValue: async () => RECU },
        ...voice.providers,
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    const answerReadings = () => {
      http.match('/api/v1/caretaker/context').forEach((request) => request.flush(contexte()));
      http.match('/api/v1/orders').forEach((request) => request.flush([]));
      http.match('/api/v1/counterparties').forEach((request) => request.flush(tiers()));
      http.match('/api/v1/cost-types').forEach((request) => request.flush(types()));
      http.match('/api/v1/reference-data').forEach((request) => request.flush({ currency: 'XOF', costCategories: [], lossTypes: [], strains: [] }));
      http.match(`/api/v1/campaigns/${BANDE}/money`).forEach((request) => request.flush(money));
    };
    const refresh = async () => {
      await settle();
      answerReadings();
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
    const keys = async (...pressed: string[]) => {
      for (const key of pressed) {
        const button = all('app-keypad .key').find((one) => one.textContent?.trim() === key);
        if (button === undefined) throw new Error(`No key ${key}`);
        button.click();
        await refresh();
      }
    };
    const type = async (selector: string, value: string) => {
      const field = element().querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
      if (field === null) throw new Error(`No field: ${selector}`);
      field.value = value;
      field.dispatchEvent(new Event('input'));
      await refresh();
    };
    const sent = (method: string, url: string) => {
      let found: TestRequest | undefined;
      return vi
        .waitFor(async () => {
          await refresh();
          found = http.match((request) => request.method === method && request.url === url)[0] ?? found;
          expect(found).toBeDefined();
        })
        .then(() => found as TestRequest);
    };
    return { element, all, tap, keys, type, sent, refresh };
  };
  const text = (node: Element | null | undefined) => node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const said = () => heard.flat();

  beforeEach(() => {
    extraTypes = [];
    localStorage.clear();
    localStorage.setItem('yaar.session', JSON.stringify({ token, expiresAt: '2099-01-01T00:00:00.000Z', role: 'admin', account: { name: 'Bassirou', avatar: 'baobab', language: 'fr' } }));
    const click = HTMLInputElement.prototype.click;
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      if (this.type !== 'file') click.call(this);
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:recu');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  describe('la liste', () => {
    it('les achats mènent aux dépenses', async () => {
      const { tap } = await ouvre('/admin/achats');

      await tap('.entries .expenses');
      expect(TestBed.inject(Router).url).toBe('/admin/achats/depenses');
    });

    it("l'engagé et le coût par poulet viennent du serveur, chacun avec son bouton d'écoute", async () => {
      const { all } = await ouvre('/admin/achats/depenses');

      expect(all('.totals .total').map(text)).toEqual([expect.stringContaining('Engagé à date 957 500 F'), expect.stringContaining('Coût par poulet 1 030 F')]);
      expect(all('.totals app-speaker-button')).toHaveLength(2);
    });

    it('sans vivants connus, le coût par poulet est dit « pas encore connu », jamais zéro', async () => {
      const { all } = await ouvre('/admin/achats/depenses', argent({ liveCount: null, costPerBird: null }));

      expect(text(all('.totals .total')[1])).toContain('pas encore connu');
    });

    it('chaque dépense dit sa date, son type, son montant, son statut, « reçu ✓ » et sa note en entier ; la plus récente en haut', async () => {
      const { all } = await ouvre('/admin/achats/depenses');

      const [owed, water] = all('.cost');
      expect(text(owed)).toMatch(/Salaire du gardien.*12\/11\/2026.*45 000 F.*À payer à Ousmane/);
      expect(text(water)).toMatch(/Eau et électricité.*10\/11\/2026.*12 500 F.*Payé.*reçu ✓/);
      expect(text(water?.querySelector('.cost-note'))).toBe(NOTE);
    });

    it('« C’est payé » passe une dépense à payer en payée, d’un geste : une contre-écriture qui ne change que le statut', async () => {
      const { tap, sent } = await ouvre('/admin/achats/depenses');

      await tap('.cost .pay');
      const request = await sent('POST', `/api/v1/costs/${uuid(302)}/revisions`);
      expect(request.request.body).toEqual({ id: expect.stringMatching(UUID), campaignId: BANDE, costTypeId: SALAIRE, spentOn: '2026-11-12', amount: 45_000, note: null, payment: { kind: 'Paid' }, receipt: null, recordedAt: NOW.toISOString() });
    });
  });

  describe('le geste', () => {
    it('quoi : une tuile par type en usage, au picto de sa catégorie ; la voix pose la question', async () => {
      const { all } = await ouvre('/admin/achats/depense');

      expect(all('.type').map(text)).toEqual(['Aliment', 'Salaire du gardien', 'Eau et électricité']);
      expect(all('.type').map((tile) => tile.querySelector('use')?.getAttribute('href')?.split('#')[1])).toEqual(['closed-bag', 'caretaker', 'drinker']);
      await vi.waitFor(() => expect(said()).toContain('fr/cost-what'));
    });

    it('combien : le pavé tape par milliers, le montant se pose en billets ; « Payé » est choisi d’office', async () => {
      const { tap, keys, element, all } = await ouvre('/admin/achats/depense');

      await tap('.type:nth-child(3)');
      await keys('4', '2', '000');

      expect(text(element().querySelector('.amount'))).toBe('42 000 F');
      expect(all('app-banknotes .note').map(text)).toEqual(['10 000', '10 000', '10 000', '10 000', '2 000']);
      expect(element().querySelector<HTMLInputElement>('.status .choice.on')?.textContent).toContain('Payé');
    });

    it('« À payer plus tard » demande à qui : un fournisseur ou un collaborateur, jamais un client ni un archivé ; sans choix, refus dit', async () => {
      const { tap, keys, all, element } = await ouvre('/admin/achats/depense');

      await tap('.type:nth-child(2)');
      await keys('4', '5', '000');
      await tap('.status .choice:nth-child(2) input');
      expect(all('.creditor').map(text)).toEqual(['Sedima', 'Ousmane']);
      await tap('.next');
      expect(text(element().querySelector('.refusal'))).toContain('Choisis à qui tu dois');
    });

    // Spec: backlog R.4 — payé par un tiers (décisions du 2026-11-12).
    it('« Payé par quelqu’un d’autre » se range derrière « Plus de détails » : tout tiers en usage, client compris, jamais un archivé', async () => {
      const { tap, keys, all, element } = await ouvre('/admin/achats/depense');
      await tap('.type:nth-child(1)');
      await keys('1', '0', '0', '000');

      expect(text(element().querySelector('.payer-more summary'))).toBe('Plus de détails : payé par quelqu’un d’autre');
      expect(all('.payer').map(text)).toEqual(['Sedima', 'Ousmane', 'Ramasseur']);
    });

    it('payé par l’acheteur : la relecture le dit, à l’écran et à la voix ; Oui envoie la dépense « payée par » lui', async () => {
      const { tap, keys, element, sent, refresh } = await ouvre('/admin/achats/depense');
      await tap('.type:nth-child(1)');
      await keys('1', '0', '0', '000');
      await tap('.payer:nth-child(3)');
      expect(element().querySelector<HTMLInputElement>('.status .choice:nth-child(1) input')?.checked).toBe(false);
      await tap('.next');

      expect(text(element().querySelector('.receipt-card .how'))).toBe('payé par Ramasseur pour toi');
      await vi.waitFor(() => expect(heard).toContainEqual(expect.arrayContaining(['fr/cost-paid-by-other'])));
      await tap('.confirm');
      expect((await sent('POST', '/api/v1/costs')).request.body).toEqual(expect.objectContaining({ amount: 100_000, payment: { kind: 'PaidBy', counterpartyId: uuid(33) } }));
      await refresh();
    });

    it('ses frais pris en charge : la case dit qu’ils se déduisent de ce qu’il doit ; ils partent comme une dépense « Frais financiers » payée par lui', async () => {
      extraTypes = [{ id: FRAIS, category: 'FinancialCharges', name: 'Frais financiers', behaviour: 'Fixed', orderable: false, archived: false }];
      const { tap, keys, type, element, sent } = await ouvre('/admin/achats/depense');
      await tap('.type:nth-child(2)');
      await keys('1', '0', '0', '000');
      expect(element().querySelector('input[name=fee]')).toBeNull();
      await tap('.payer:nth-child(3)');

      expect(text(element().querySelector('app-fee-field'))).toContain('Frais de transfert payés par Ramasseur, à ta charge');
      await type('input[name=fee]', '1000');
      await tap('.next');
      expect(text(element().querySelector('.receipt-card .fee-words'))).toBe('et 1 000 F de frais, à ta charge');
      await tap('.confirm');

      const cost = await sent('POST', '/api/v1/costs');
      expect(cost.request.body).toEqual(expect.objectContaining({ amount: 100_000, payment: { kind: 'PaidBy', counterpartyId: uuid(33) } }));
      cost.flush(null, { status: 201, statusText: 'Created' });
      let fee: TestRequest | undefined;
      await vi.waitFor(() => {
        fee = http.match((request) => request.method === 'POST' && request.url === '/api/v1/costs')[0] ?? fee;
        expect(fee).toBeDefined();
      });
      expect(fee?.request.body).toEqual(expect.objectContaining({ costTypeId: FRAIS, amount: 1_000, note: 'Frais de transfert — Aliment payé par Ramasseur', payment: { kind: 'PaidBy', counterpartyId: uuid(33) } }));
    });

    it('rechoisir « Payé » oublie le tiers', async () => {
      const { tap, keys, element } = await ouvre('/admin/achats/depense');
      await tap('.type:nth-child(1)');
      await keys('1', '0', '0', '000');
      await tap('.payer:nth-child(3)');
      await tap('.status .choice:nth-child(1) input');
      await tap('.next');

      expect(text(element().querySelector('.receipt-card .how'))).toBe('payé aujourd’hui');
    });

    it('la relecture montre le montant en billets, la voix relit d’office : la catégorie, le montant, payé ; Non revient au montant sans rien perdre', async () => {
      const { tap, keys, element } = await ouvre('/admin/achats/depense');

      await tap('.type:nth-child(3)');
      await keys('1', '2', '5', '0', '0');
      await tap('.next');

      expect(text(element().querySelector('.receipt-card'))).toMatch(/Eau et électricité.*Poulailler Nord · Jour 11.*12 500 F.*payé aujourd’hui/);
      await vi.waitFor(() => expect(heard).toContainEqual(expect.arrayContaining(['fr/cost-category-utilities', 'fr/money-amount', 'fr/money-francs', 'fr/cost-paid', 'fr/confirm'])));
      await tap('.actions .no');
      expect(text(element().querySelector('.amount'))).toBe('12 500 F');
    });

    it('Oui envoie la dépense, avec un identifiant créé ici et la date du jour, puis revient à la liste du lot', async () => {
      const { tap, keys, sent } = await ouvre('/admin/achats/depense');

      await tap('.type:nth-child(3)');
      await keys('1', '2', '5', '0', '0');
      await tap('.next');
      await tap('.confirm');
      const request = await sent('POST', '/api/v1/costs');

      expect(request.request.body).toEqual({ id: expect.stringMatching(UUID), campaignId: BANDE, costTypeId: EAU, spentOn: '2026-11-12', amount: 12_500, note: null, payment: { kind: 'Paid' }, receipt: null, recordedAt: NOW.toISOString() });
      request.flush(null, { status: 201, statusText: 'Created' });
      await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe(`/admin/achats/depenses?lot=${BANDE}`));
    });

    it('la règle du domaine refuse avant tout envoi : une date de dépense après aujourd’hui', async () => {
      const { tap, keys, type, element } = await ouvre('/admin/achats/depense');

      await tap('.type:nth-child(3)');
      await keys('1', '000');
      await tap('.next');
      await type('input[name=spentOn]', '2026-11-13');
      await tap('.confirm');

      expect(text(element().querySelector('.refusal'))).toContain('La date ne peut pas être après aujourd’hui');
      expect(http.match((request) => request.method === 'POST')).toEqual([]);
    });

    it('une note et la photo du reçu, derrière « Plus de détails » : le reçu part d’abord comme pièce justificative, la dépense le cite', async () => {
      const { tap, keys, type, sent, element } = await ouvre('/admin/achats/depense');

      await tap('.type:nth-child(3)');
      await keys('1', '2', '5', '0', '0');
      await tap('.next');
      await type('textarea[name=note]', 'Facture SDE');
      await tap('.details .photo');
      const camera = element().querySelector<HTMLInputElement>('input[type=file]');
      Object.defineProperty(camera, 'files', { value: [new File([RECU], 'recu.jpg', { type: 'image/jpeg' })], configurable: true });
      camera?.dispatchEvent(new Event('change'));
      await vi.waitFor(() => expect(element().querySelector<HTMLImageElement>('.receipt img')?.src).toBe('blob:recu'));
      await tap('.confirm');

      const upload = await vi.waitFor(() => {
        const [request] = http.match((one) => one.method === 'PUT' && one.url.startsWith('/api/v1/media/'));
        expect(request).toBeDefined();
        return request as TestRequest;
      });
      expect(upload.request.params.get('retention')).toBe('SupportingDocument');
      const fingerprint = upload.request.url.split('/').pop();
      upload.flush(null, { status: 201, statusText: 'Created' });
      const request = await sent('POST', '/api/v1/costs');
      expect(request.request.body).toMatchObject({ note: 'Facture SDE', receipt: fingerprint });
    });

    // Spec: backlog P.7 — une dépense saisie sans réseau est gardée avec son identifiant, se distingue à l'écran, et part au retour du réseau une seule fois.
    it('sans réseau, la dépense est gardée sur l’appareil et la liste la dit « en attente d’envoi » ; au retour du réseau, la même dépense repart', async () => {
      const { tap, keys, sent, element } = await ouvre('/admin/achats/depense');

      await tap('.type:nth-child(3)');
      await keys('1', '000');
      await tap('.next');
      await tap('.confirm');
      const first = await sent('POST', '/api/v1/costs');
      first.error(new ProgressEvent('error'));
      await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe(`/admin/achats/depenses?lot=${BANDE}`));
      await vi.waitFor(() => expect(text(element().querySelector('app-office-pending li'))).toBe('Dépense de 1 000 F en attente d’envoi'));

      globalThis.dispatchEvent(new Event('online'));
      const again = await sent('POST', '/api/v1/costs');
      expect((again.request.body as { id: string }).id).toBe((first.request.body as { id: string }).id);
    });

    it('une fois la dépense reçue par le serveur, la liste du lot relit ses chiffres ; une dépense en attente d’un autre lot ne s’y montre pas', async () => {
      const { tap, keys, sent, element, refresh } = await ouvre('/admin/achats/depense');

      await tap('.type:nth-child(3)');
      await keys('1', '000');
      await tap('.next');
      await tap('.confirm');
      await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe(`/admin/achats/depenses?lot=${BANDE}`));
      // The office reads the lot's money, then the cost reaches the server: the money is read again.
      http.match(`/api/v1/campaigns/${BANDE}/money`).forEach((request) => request.flush(argent()));
      (await sent('POST', '/api/v1/costs')).flush(null, { status: 201, statusText: 'Created' });
      await vi.waitFor(async () => {
        await settle();
        expect(http.match(`/api/v1/campaigns/${BANDE}/money`).length).toBeGreaterThan(0);
      });

      // An entry of another lot waits on the device: it is not this lot's.
      const queue = await TestBed.inject(OFFICE_QUEUE);
      await queue?.keep(LE_GERANT, 'cost', '/api/v1/costs', { id: uuid(901), amount: 7_000 }, uuid(5));
      await TestBed.inject(OfficeSync).dismiss('none');
      await refresh();
      expect(element().querySelectorAll('app-office-pending li')).toHaveLength(0);
    });

    it('refusée par le serveur, la dépense reste visible avec son motif, jusqu’à « J’ai vu »', async () => {
      const { tap, keys, sent, element, refresh } = await ouvre('/admin/achats/depense');

      await tap('.type:nth-child(3)');
      await keys('1', '000');
      await tap('.next');
      await tap('.confirm');
      (await sent('POST', '/api/v1/costs')).flush({ kind: 'CampaignClosed' }, { status: 400, statusText: 'Bad Request' });
      await vi.waitFor(async () => {
        await refresh();
        expect(text(element().querySelector('app-office-pending li.refused'))).toContain('refusé : le lot est clos');
      });

      await tap('app-office-pending .seen');
      await vi.waitFor(async () => {
        await refresh();
        expect(element().querySelector('app-office-pending li')).toBeNull();
      });
    });

    it('chaque écran dit de quand datent ses chiffres ; sans réseau, la dernière lecture reste, avec son jour et son heure', async () => {
      const { element } = await ouvre('/admin/achats/depenses');

      expect(text(element().querySelector('app-figures-age'))).toMatch(/^Chiffres de \d+ h \d\d$/);
    });

    it('l’accueil et les lots disent aussi de quand datent leurs chiffres', async () => {
      for (const url of ['/admin/accueil', '/admin/lots']) {
        TestBed.resetTestingModule();
        const { element } = await ouvre(url);
        expect(text(element().querySelector('app-figures-age'))).toMatch(/^Chiffres de \d+ h \d\d$/);
      }
    });
  });

  describe('dupliquer et corriger', () => {
    it('« Dupliquer » remplit le geste — type, montant, statut, note — à la date du jour, sans rien enregistrer ; Oui écrit une nouvelle dépense', async () => {
      const { tap, sent, element } = await ouvre(`/admin/achats/depense?lot=${BANDE}&from=${uuid(301)}`);

      expect(text(element().querySelector('.amount'))).toBe('12 500 F');
      expect(http.match((request) => request.method === 'POST')).toEqual([]);
      await tap('.next');
      expect(text(element().querySelector('.receipt-card'))).toContain('payé aujourd’hui');
      await tap('.confirm');
      const request = await sent('POST', '/api/v1/costs');
      expect(request.request.body).toMatchObject({ costTypeId: EAU, amount: 12_500, spentOn: '2026-11-12', note: NOTE, receipt: null });
      expect((request.request.body as { id: string }).id).not.toBe(uuid(301));
    });

    it('« Corriger » remplit tout, date et reçu compris ; Oui écrit une contre-écriture de cette dépense', async () => {
      const { tap, keys, sent } = await ouvre(`/admin/achats/depense?lot=${BANDE}&corrige=${uuid(301)}`);

      await keys('0');
      await tap('.next');
      await tap('.confirm');
      const request = await sent('POST', `/api/v1/costs/${uuid(301)}/revisions`);
      expect(request.request.body).toMatchObject({ costTypeId: EAU, amount: 125_000, spentOn: '2026-11-10', receipt: 'e'.repeat(64) });
    });
  });
});
