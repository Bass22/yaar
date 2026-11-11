import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { CampaignMoneyView, CaretakerContext, CostView, CounterpartyView, CostTypeView } from '@contracts';
import { provideHeardVoice } from '../../core/audio/testing';
import { CLOCK } from '../../core/clock';
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
  sites: [{ siteId: NORD, name: 'Poulailler Nord', timeZone: 'Africa/Dakar', today: '2026-11-12', primaryCaretakerId: null, campaigns: [{ campaignId: BANDE, placementDay: '2026-11-01', campaignDay: 11, liveCount: 997, journal: [], deliveries: [] }] }],
});
const tiers = (): CounterpartyView[] => [
  { id: SEDIMA, kind: 'Supplier', name: 'Sedima', face: 'closed-bag', archived: false },
  { id: OUSMANE, kind: 'Collaborator', name: 'Ousmane', face: 'caretaker', archived: false },
  { id: uuid(33), kind: 'Customer', name: 'Ramasseur', face: 'hen', archived: false },
  { id: uuid(34), kind: 'Supplier', name: 'Ancien', face: 'truck', archived: true },
];
const types = (): CostTypeView[] => [
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
const RECORDED = ['cost-what', 'cost-how-much', 'cost-category-utilities', 'cost-category-labour', 'money-amount', 'money-francs', 'cost-paid', 'cost-to-pay', 'confirm', 'committed', 'cost-per-bird', 'cost-per-bird-unknown', 'written-thanks', 'number-1000', 'number-2000', 'number-12', 'number-42', 'number-500', 'number-30', 'number-957'];

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
        { provide: CLOCK, useValue: { now: () => NOW } },
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
      expect(request.request.body).toEqual({ id: expect.stringMatching(UUID), campaignId: BANDE, costTypeId: SALAIRE, spentOn: '2026-11-12', amount: 45_000, note: null, payment: { kind: 'Paid' }, receipt: null });
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

      expect(request.request.body).toEqual({ id: expect.stringMatching(UUID), campaignId: BANDE, costTypeId: EAU, spentOn: '2026-11-12', amount: 12_500, note: null, payment: { kind: 'Paid' }, receipt: null });
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

    it('sans réseau, rien n’est enregistré et il le dit ; réessayer renvoie la même dépense', async () => {
      const { tap, keys, sent, element } = await ouvre('/admin/achats/depense');

      await tap('.type:nth-child(3)');
      await keys('1', '000');
      await tap('.next');
      await tap('.confirm');
      const first = await sent('POST', '/api/v1/costs');
      first.error(new ProgressEvent('error'));
      await vi.waitFor(() => expect(text(element().querySelector('.refusal'))).toContain('Pas de réseau'));

      await tap('.confirm');
      const again = await sent('POST', '/api/v1/costs');
      expect((again.request.body as { id: string }).id).toBe((first.request.body as { id: string }).id);
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
