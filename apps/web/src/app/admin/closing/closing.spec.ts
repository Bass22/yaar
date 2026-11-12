import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { IDBFactory } from 'fake-indexeddb';
import type { CaretakerContext, ClosedLotView, ClosingReportView, CostTypeView } from '@contracts';
import { provideHeardVoice } from '../../core/audio/testing';
import { CLOCK } from '../../core/clock';
import { OfficeQueue } from '../../core/outbox/office-queue';
import { adminRoutes } from '../admin.routes';
import { OFFICE_QUEUE } from '../office-sync';

// Spec: backlog X.2 — clôturer une campagne ; cahier des charges « Les restes et le bilan »
// (décisions du 2026-11-12 : restes de tout ce qui se commande sauf les poussins, un entamé compté
// pour moitié ; l'admin choisit la bande du même site qui les reçoit ; le bilan n'existe qu'à la
// clôture ; coût par poulet face au prix de vente par poussin reçu).

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT = uuid(10);
const LE_GERANT = uuid(54);
const NORD = uuid(3);
const SUD = uuid(8);
const BANDE = uuid(4);
const SUIVANTE = uuid(5);
const AU_SUD = uuid(6);
const DEMARRAGE = uuid(43);
const ANTIBIOTIQUE = uuid(44);
const token = `e30.${btoa(JSON.stringify({ sub: LE_GERANT, tenant: TENANT })).replace(/=+$/, '')}.c2ln`;
const NOW = new Date('2026-11-04T10:00:00.000Z');
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

const lot = (campaignId: string, placementDay: string, campaignDay: number) => ({ campaignId, placementDay, campaignDay, liveCount: 50, journal: [], deliveries: [], weighingRequests: [], strain: 'Cobb500' });
const contexte = (): CaretakerContext => ({
  chef: null,
  sites: [
    { siteId: NORD, name: 'Poulailler Nord', timeZone: 'Africa/Dakar', today: '2026-11-04', primaryCaretakerId: null, campaigns: [lot(BANDE, '2026-10-12', 23), lot(SUIVANTE, '2026-11-01', 3)] },
    { siteId: SUD, name: 'Poulailler Sud', timeZone: 'Africa/Dakar', today: '2026-11-04', primaryCaretakerId: null, campaigns: [lot(AU_SUD, '2026-10-20', 15)] },
  ],
});
const type = (id: string, category: CostTypeView['category'], name: string, fields: Partial<CostTypeView> = {}): CostTypeView => ({ id, category, name, behaviour: 'Variable', orderable: true, archived: false, ...fields });
const TYPES: CostTypeView[] = [
  type(uuid(42), 'Chicks', 'Poussins'),
  type(DEMARRAGE, 'Feed', 'Aliment démarrage'),
  type(ANTIBIOTIQUE, 'Health', 'Antibiotique'),
  type(uuid(45), 'Feed', 'Ancien aliment', { archived: true }),
  type(uuid(46), 'Labour', 'Salaire', { orderable: false }),
];
const bilan = (fields: Partial<ClosingReportView> = {}): ClosingReportView => ({
  campaignId: BANDE,
  siteName: 'Poulailler Nord',
  placementDay: '2026-10-12',
  closedAt: '2026-11-04T10:00:00.000Z',
  currency: 'XOF',
  chicksReceived: 1000,
  deaths: 50,
  losses: 0,
  birdsSold: 900,
  costs: 975_000,
  leftovers: [
    { costTypeId: DEMARRAGE, name: 'Aliment démarrage', unit: 'bag', whole: 2, opened: true, value: 37_500 },
    { costTypeId: uuid(45), name: 'Copeaux', unit: 'bag', whole: 1, opened: false, value: null },
  ],
  leftoversTo: { campaignId: SUIVANTE, siteName: 'Poulailler Nord', placementDay: '2026-11-01' },
  leftoversValue: 37_500,
  netCost: 937_500,
  revenue: 2_250_000,
  cashedIn: 2_000_000,
  costPerBird: 938,
  revenuePerChick: 2_250,
  profit: 1_312_500,
  comment: 'Bonne bande.\nChaleur en semaine 4.',
  ...fields,
});

describe('La clôture d’une bande, au bureau', () => {
  let http: HttpTestingController;
  let closings: TestRequest[];

  type Answers = { report?: ClosingReportView | 404; closing?: 'ok' | 'no-network' | { status: number; kind: string }; closed?: ClosedLotView[] };
  const ouvre = async (url: string, answers: Answers = {}) => {
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
    closings = [];
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    const refresh = async () => {
      await settle();
      http.match('/api/v1/caretaker/context').forEach((request) => request.flush(contexte()));
      http.match('/api/v1/cost-types').forEach((request) => request.flush(TYPES));
      http.match('/api/v1/campaigns/closed').forEach((request) => request.flush(answers.closed ?? []));
      http.match((request) => request.url.endsWith('/closing-report')).forEach((request) => (answers.report === 404 || answers.report === undefined ? request.flush({}, { status: 404, statusText: 'Not Found' }) : request.flush(answers.report)));
      http.match((request) => request.url.endsWith('/closing')).forEach((request) => {
        closings.push(request);
        const closing = answers.closing ?? 'ok';
        if (closing === 'ok') request.flush(null, { status: 204, statusText: 'No Content' });
        else if (closing === 'no-network') request.error(new ProgressEvent('error'));
        else request.flush({ kind: closing.kind }, { status: closing.status, statusText: 'Refused' });
      });
      harness.detectChanges();
      await harness.fixture.whenStable();
      harness.detectChanges();
    };
    await refresh();
    await refresh();
    const element = () => harness.routeNativeElement?.closest('app-office-shell') as HTMLElement;
    const find = <T extends HTMLElement>(selector: string): T => {
      const target = element().querySelector<T>(selector);
      if (target === null) throw new Error(`Nothing here: ${selector}`);
      return target;
    };
    // Twice: the answer of the server, then what follows it (a navigation).
    const tap = async (selector: string) => {
      find(selector).click();
      await refresh();
      await refresh();
    };
    const type_ = async (selector: string, value: string) => {
      const input = find<HTMLInputElement | HTMLTextAreaElement>(selector);
      input.value = value;
      input.dispatchEvent(new Event('input'));
      await refresh();
    };
    return { element, tap, type: type_ };
  };
  const text = (node: Element | null | undefined) => node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('yaar.session', JSON.stringify({ token, expiresAt: '2099-01-01T00:00:00.000Z', role: 'admin', account: { name: 'Bassirou', avatar: 'baobab', language: 'fr' } }));
  });

  describe('clôturer', () => {
    it('les lots mènent à la clôture', async () => {
      const { tap } = await ouvre('/admin/lots');

      await tap('a.closing');
      expect(TestBed.inject(Router).url).toBe('/admin/lots/cloture');
    });

    it('les lots mènent aux lots clôturés', async () => {
      const { tap } = await ouvre('/admin/lots');

      await tap('a.closed-lots');
      expect(TestBed.inject(Router).url).toBe('/admin/lots/clos');
    });

    it('les restes se saisissent pour ce qui se commande : ni poussins, ni type archivé, ni ce qui ne se commande pas ; en sacs ou en unités', async () => {
      const { element } = await ouvre(`/admin/lots/cloture?lot=${BANDE}`);

      expect(Array.from(element().querySelectorAll('.leftover')).map((row) => text(row.querySelector('.name')))).toEqual(['Aliment démarrage', 'Antibiotique']);
      expect(text(element().querySelector(`.leftover[data-type="${DEMARRAGE}"] .unit`))).toBe('sacs');
      expect(text(element().querySelector(`.leftover[data-type="${ANTIBIOTIQUE}"] .unit`))).toBe('unités');
    });

    it('sans rien saisir : aucun reste, pas de bande à choisir ; la clôture se confirme, puis s’envoie et mène au bilan', async () => {
      const { element, tap } = await ouvre(`/admin/lots/cloture?lot=${BANDE}`);

      // La bande visée est toujours nommée, même seule (vu à 360 px : rien ne la disait)
      expect(text(element().querySelector('.current'))).toBe('La bande du Poulailler Nord · Jour 23');
      expect(text(element().querySelector('.nothing-left'))).toBe('Aucun reste : rien ne passe à une autre bande.');
      expect(element().querySelector('.receivers')).toBeNull();
      await tap('button.close');
      expect(closings).toHaveLength(0);
      expect(text(element().querySelector('.confirm p'))).toBe('La clôture est définitive : plus aucune déclaration, aucun coût, aucune vente sur cette bande.');

      await tap('.confirm button.yes');
      expect(closings.map((request) => [request.request.url, request.request.body])).toEqual([[`/api/v1/campaigns/${BANDE}/closing`, { leftovers: [], leftoversTo: null, comment: null }]]);
      expect(TestBed.inject(Router).url).toBe(`/admin/lots/bilan/${BANDE}`);
    });

    it('avec des restes : on choisit la bande qui les reçoit parmi les autres bandes du même site, puis tout part ensemble', async () => {
      const { element, tap, type } = await ouvre(`/admin/lots/cloture?lot=${BANDE}`);

      await type(`.leftover[data-type="${DEMARRAGE}"] input.whole`, '2');
      await tap(`.leftover[data-type="${DEMARRAGE}"] input.opened`);
      await tap(`.leftover[data-type="${ANTIBIOTIQUE}"] input.opened`);
      // Ni elle-même, ni la bande du Poulailler Sud
      expect(Array.from(element().querySelectorAll('.receivers label')).map(text)).toEqual(['Poulailler Nord · Jour 3']);
      expect(find<HTMLButtonElement>(element, 'button.close').disabled).toBe(true);
      expect(text(element().querySelector('.no-receiver-chosen'))).toBe('Choisis la bande qui reçoit les restes.');

      await tap('.receivers input');
      await type('textarea.comment', 'Bonne bande.');
      await tap('button.close');
      await tap('.confirm button.yes');

      expect(closings[0]?.request.body).toEqual({
        leftovers: [
          { costTypeId: DEMARRAGE, whole: 2, opened: true },
          { costTypeId: ANTIBIOTIQUE, whole: 0, opened: true },
        ],
        leftoversTo: SUIVANTE,
        comment: 'Bonne bande.',
      });
    });

    it('des restes effacés après avoir choisi la bande : rien ne passe, aucune bande n’est envoyée', async () => {
      const { tap, type } = await ouvre(`/admin/lots/cloture?lot=${BANDE}`);

      await type(`.leftover[data-type="${DEMARRAGE}"] input.whole`, '2');
      await tap('.receivers input');
      await type(`.leftover[data-type="${DEMARRAGE}"] input.whole`, '');
      await tap('button.close');
      await tap('.confirm button.yes');

      expect(closings[0]?.request.body).toEqual({ leftovers: [], leftoversTo: null, comment: null });
    });

    it('seule bande de son site : les restes n’ont nulle part où aller, l’écran le dit', async () => {
      const { element, tap } = await ouvre(`/admin/lots/cloture?lot=${AU_SUD}`);

      await tap(`.leftover[data-type="${DEMARRAGE}"] input.opened`);
      expect(text(element().querySelector('.no-receiver'))).toBe('Aucune autre bande en cours sur ce site : ouvre la suivante d’abord, ou ne saisis aucun reste.');
      expect(find<HTMLButtonElement>(element, 'button.close').disabled).toBe(true);
    });

    it('un nombre qui n’est pas entier n’est pas un reste', async () => {
      const { element, type } = await ouvre(`/admin/lots/cloture?lot=${BANDE}`);

      await type(`.leftover[data-type="${DEMARRAGE}"] input.whole`, '1.5');
      expect(text(element().querySelector('.invalid'))).toBe('Un nombre entier de sacs ou d’unités ; un entamé se coche à part.');
      expect(find<HTMLButtonElement>(element, 'button.close').disabled).toBe(true);
    });

    it('revenir sur la confirmation n’envoie rien', async () => {
      const { tap } = await ouvre(`/admin/lots/cloture?lot=${BANDE}`);

      await tap('button.close');
      await tap('.confirm button.no');
      expect(closings).toHaveLength(0);
    });

    it('une bande déjà close : le refus du serveur se dit, on reste sur la page', async () => {
      const { element, tap } = await ouvre(`/admin/lots/cloture?lot=${BANDE}`, { closing: { status: 409, kind: 'CampaignClosed' } });

      await tap('button.close');
      await tap('.confirm button.yes');
      expect(text(element().querySelector('.refusal'))).toBe('Cette bande est déjà close.');
      expect(TestBed.inject(Router).url).toBe(`/admin/lots/cloture?lot=${BANDE}`);
    });

    it('sans réseau : la clôture demande le réseau, rien n’est perdu de la saisie', async () => {
      const { element, tap, type } = await ouvre(`/admin/lots/cloture?lot=${BANDE}`, { closing: 'no-network' });

      await type('textarea.comment', 'Bonne bande.');
      await tap('button.close');
      await tap('.confirm button.yes');
      expect(text(element().querySelector('.refusal'))).toBe('Pas de réseau : la clôture demande le réseau. Réessaie plus tard.');
      expect(find<HTMLTextAreaElement>(element, 'textarea.comment').value).toBe('Bonne bande.');
    });
  });

  describe('le bilan', () => {
    it('le coût par poulet face au prix de vente par poussin reçu, le bénéfice', async () => {
      const { element } = await ouvre(`/admin/lots/bilan/${BANDE}`, { report: bilan() });

      expect(text(element().querySelector('.kpi.cost'))).toBe('938 F coût par poussin reçu');
      expect(text(element().querySelector('.kpi.price'))).toBe('2 250 F vente par poussin reçu');
      expect(text(element().querySelector('.kpi.profit'))).toBe('1 312 500 F bénéfice');
      expect(element().querySelector('.kpi.profit strong')?.classList.contains('negative')).toBe(false);
    });

    it('les poulets, l’argent, les restes et la bande qui les a reçus ; une valeur inconnue le dit', async () => {
      const { element } = await ouvre(`/admin/lots/bilan/${BANDE}`, { report: bilan() });

      expect(Array.from(element().querySelectorAll('.flock .line')).map(text)).toEqual(['Poussins reçus 1 000', 'Morts 50', 'Pertes (manquants, dons, vols) 0', 'Poulets vendus 900']);
      expect(Array.from(element().querySelectorAll('.money .line')).map(text)).toEqual(['Coûts 975 000 F', 'Restes transférés − 37 500 F', 'Coût net 937 500 F', 'Chiffre d’affaires 2 250 000 F', 'Encaissé 2 000 000 F']);
      expect(Array.from(element().querySelectorAll('.leftovers li')).map(text)).toEqual(['Aliment démarrage : 2 sacs et un entamé 37 500 F', 'Copeaux : 1 sac valeur inconnue']);
      expect(text(element().querySelector('.leftovers .to'))).toBe('Passés à la bande du Poulailler Nord mise en place le 01/11/2026.');
    });

    it('une bande qui perd : le bénéfice est rouge et signé', async () => {
      const { element } = await ouvre(`/admin/lots/bilan/${BANDE}`, { report: bilan({ profit: -120_000 }) });

      expect(text(element().querySelector('.kpi.profit strong'))).toBe('−120 000 F');
      expect(element().querySelector('.kpi.profit strong')?.classList.contains('negative')).toBe(true);
    });

    it('le commentaire en entier, sur ses lignes ; sans poussin reçu, les chiffres par poussin restent à blanc', async () => {
      const { element } = await ouvre(`/admin/lots/bilan/${BANDE}`, { report: bilan({ costPerBird: null, revenuePerChick: null, leftovers: [], leftoversTo: null }) });

      expect(element().querySelector('.comment')?.textContent).toBe('Bonne bande.\nChaleur en semaine 4.');
      expect(text(element().querySelector('.kpi.cost strong'))).toBe('—');
      expect(text(element().querySelector('.kpi.price strong'))).toBe('—');
      expect(text(element().querySelector('.leftovers .none'))).toBe('Aucun reste.');
    });

    it('une bande pas close n’a pas de bilan', async () => {
      const { element } = await ouvre(`/admin/lots/bilan/${BANDE}`, { report: 404 });

      expect(text(element().querySelector('.missing'))).toBe('Pas de bilan : cette bande n’est pas close, ou le réseau manque.');
    });
  });

  it('les lots clôturés, chacun menant à son bilan', async () => {
    const { element, tap } = await ouvre('/admin/lots/clos', { closed: [{ campaignId: BANDE, siteName: 'Poulailler Nord', placementDay: '2026-10-12', closedAt: '2026-11-04T10:00:00.000Z' }], report: bilan() });

    expect(Array.from(element().querySelectorAll('a.closed-lot')).map(text)).toEqual(['Poulailler Nord · mise en place le 12/10/2026, close le 04/11/2026']);
    await tap('a.closed-lot');
    expect(TestBed.inject(Router).url).toBe(`/admin/lots/bilan/${BANDE}`);
  });
});

function find<T extends HTMLElement>(element: () => HTMLElement, selector: string): T {
  const target = element().querySelector<T>(selector);
  if (target === null) throw new Error(`Nothing here: ${selector}`);
  return target;
}
