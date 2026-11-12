import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { IDBFactory } from 'fake-indexeddb';
import type { BudgetLineView, BudgetView, CaretakerContext } from '@contracts';
import { provideHeardVoice } from '../../core/audio/testing';
import { CLOCK } from '../../core/clock';
import { OfficeQueue } from '../../core/outbox/office-queue';
import { adminRoutes } from '../admin.routes';
import { OFFICE_QUEUE } from '../office-sync';

// Spec: backlog S.3 — budget contre engagé à l'écran ; cahier des charges « Budget de campagne »
// (décisions du 2026-11-12 : un poste = une catégorie ; la proposition de l'historique pré-remplit,
// l'admin la change à sa guise ; un poste sans budget n'affiche pas zéro ; un dépassement porte
// picto, couleur et mot).

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT = uuid(10);
const LE_GERANT = uuid(54);
const NORD = uuid(3);
const BANDE = uuid(4);
const token = `e30.${btoa(JSON.stringify({ sub: LE_GERANT, tenant: TENANT })).replace(/=+$/, '')}.c2ln`;
const NOW = new Date('2026-11-04T10:00:00.000Z');
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

const contexte = (): CaretakerContext => ({
  chef: null,
  sites: [{ siteId: NORD, name: 'Poulailler Nord', timeZone: 'Africa/Dakar', today: '2026-11-04', primaryCaretakerId: null, campaigns: [{ campaignId: BANDE, placementDay: '2026-10-12', campaignDay: 23, liveCount: 938, journal: [], deliveries: [], weighingRequests: [], strain: 'Cobb500' }] }],
});
const ligne = (category: BudgetLineView['category'], fields: Partial<BudgetLineView> = {}): BudgetLineView => ({ category, budget: null, suggested: null, committed: 0, variance: null, ...fields });
const budget = (lines: BudgetLineView[]): BudgetView => ({ campaignId: BANDE, currency: 'XOF', plannedHeadcount: 1050, closed: false, lines });
const LIGNES = [
  ligne('Feed', { budget: 1_365_000, suggested: 1_365_000, committed: 300_000, variance: 1_065_000 }),
  ligne('Chicks', { suggested: 525_000, committed: 500_000 }),
  ligne('Labour', { budget: 100_000, committed: 150_000, variance: -50_000 }),
  ligne('Transport'),
];

describe('Le budget d’une bande, au bureau', () => {
  let http: HttpTestingController;
  let writes: TestRequest[];

  const ouvre = async (url: string, answer: { view?: BudgetView | 'no-network'; write?: 'ok' | 'no-network' | { status: number; kind: string } } = {}) => {
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
    writes = [];
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    const refresh = async () => {
      await settle();
      http.match('/api/v1/caretaker/context').forEach((request) => request.flush(contexte()));
      http.match((request) => request.method === 'GET' && request.url === `/api/v1/campaigns/${BANDE}/budget`).forEach((request) => {
        const view = answer.view ?? budget(LIGNES);
        if (view === 'no-network') request.error(new ProgressEvent('error'));
        else request.flush(view);
      });
      http.match((request) => request.method === 'PUT').forEach((request) => {
        writes.push(request);
        const write = answer.write ?? 'ok';
        if (write === 'ok') request.flush(null, { status: 204, statusText: 'No Content' });
        else if (write === 'no-network') request.error(new ProgressEvent('error'));
        else request.flush({ kind: write.kind }, { status: write.status, statusText: 'Refused' });
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
      await refresh();
    };
    const type = async (selector: string, value: string) => {
      const input = element().querySelector<HTMLInputElement>(selector);
      if (input === null) throw new Error(`Nothing to type in: ${selector}`);
      input.value = value;
      input.dispatchEvent(new Event('input'));
      await refresh();
    };
    return { element, tap, type };
  };
  const text = (node: Element | null | undefined) => node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const row = (element: () => HTMLElement, category: string) => element().querySelector(`.post[data-category="${category}"]`);

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('yaar.session', JSON.stringify({ token, expiresAt: '2099-01-01T00:00:00.000Z', role: 'admin', account: { name: 'Bassirou', avatar: 'baobab', language: 'fr' } }));
  });

  it('les lots mènent au budget', async () => {
    const { tap } = await ouvre('/admin/lots');

    await tap('a.budget');
    expect(TestBed.inject(Router).url).toBe('/admin/lots/budget');
  });

  it('chaque poste montre son budget et son engagé, et ce qui reste', async () => {
    const { element } = await ouvre('/admin/lots/budget');

    // Vu à 360 px : la bande seule n'était pas nommée, et « 1050 » s'écrivait sans espace
    expect(text(element().querySelector('.current'))).toBe('La bande du Poulailler Nord · Jour 23');
    expect(element().querySelector('.hint')?.textContent).toContain('1\u00a0050 poussins prévus');
    expect(text(row(element, 'Feed')?.querySelector('.name'))).toBe('Aliments');
    expect(row(element, 'Feed')?.querySelector<HTMLInputElement>('input.amount')?.value).toBe('1365000');
    expect(text(row(element, 'Feed')?.querySelector('.committed'))).toBe('engagé 300 000 F');
    expect(text(row(element, 'Feed')?.querySelector('.variance'))).toBe('reste 1 065 000 F');
    expect(row(element, 'Feed')?.querySelector('.variance')?.classList.contains('overrun')).toBe(false);
  });

  it('un dépassement porte un picto, la couleur d’alerte et le mot', async () => {
    const { element } = await ouvre('/admin/lots/budget');
    const ecart = row(element, 'Labour')?.querySelector('.variance');

    expect(text(ecart)).toBe('dépassé de 50 000 F');
    expect(ecart?.classList.contains('overrun')).toBe(true);
    expect(ecart?.querySelector('app-pictogram')).not.toBeNull();
  });

  it('un poste sans budget n’affiche pas zéro ; la proposition de l’historique pré-remplit la case, dite « proposé »', async () => {
    const { element } = await ouvre('/admin/lots/budget');

    expect(row(element, 'Chicks')?.querySelector<HTMLInputElement>('input.amount')?.value).toBe('525000');
    expect(text(row(element, 'Chicks')?.querySelector('.suggested'))).toBe('proposé d’après tes bandes closes');
    expect(text(row(element, 'Chicks')?.querySelector('.variance'))).toBe('pas de budget');
    expect(row(element, 'Transport')?.querySelector<HTMLInputElement>('input.amount')?.value).toBe('');
    expect(text(row(element, 'Transport')?.querySelector('.variance'))).toBe('pas de budget');
  });

  it('enregistrer : n’envoie que ce qui change, la proposition acceptée comprise ; une case vidée retire le budget du poste', async () => {
    const { tap, type } = await ouvre('/admin/lots/budget');

    await type('.post[data-category="Labour"] input.amount', '200000');
    await type('.post[data-category="Feed"] input.amount', '');
    await tap('button.save');

    expect(writes).toHaveLength(1);
    expect(writes[0]?.request.url).toBe(`/api/v1/campaigns/${BANDE}/budget`);
    expect(writes[0]?.request.body).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/) as string,
      lines: [
        { category: 'Feed', amount: null },
        { category: 'Chicks', amount: 525_000 },
        { category: 'Labour', amount: 200_000 },
      ],
    });
  });

  it('un montant qui n’est pas un nombre entier de francs bloque l’enregistrement', async () => {
    const { element, type } = await ouvre('/admin/lots/budget');

    await type('.post[data-category="Labour"] input.amount', '1,5');
    expect(text(element().querySelector('.invalid'))).toBe('Un budget s’écrit en francs entiers.');
    expect(element().querySelector<HTMLButtonElement>('button.save')?.disabled).toBe(true);
  });

  it('sans réseau à l’enregistrement : l’écran le dit et garde la saisie', async () => {
    const { element, tap, type } = await ouvre('/admin/lots/budget', { write: 'no-network' });

    await type('.post[data-category="Labour"] input.amount', '200000');
    await tap('button.save');
    expect(text(element().querySelector('.refusal'))).toBe('Pas de réseau : le budget s’enregistre en ligne. Réessaie plus tard.');
    expect(row(element, 'Labour')?.querySelector<HTMLInputElement>('input.amount')?.value).toBe('200000');
  });

  it('sans réseau à la lecture : l’écran le dit au lieu de cases vides', async () => {
    const { element } = await ouvre('/admin/lots/budget', { view: 'no-network' });

    expect(text(element().querySelector('.unreachable'))).toBe('Pas de réseau : le budget se lit en ligne. Réessaie plus tard.');
    expect(element().querySelector('.post')).toBeNull();
  });
});
