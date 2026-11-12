import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { IDBFactory } from 'fake-indexeddb';
import type { CaretakerContext, TrackingView } from '@contracts';
import { provideHeardVoice } from '../../core/audio/testing';
import { CLOCK } from '../../core/clock';
import { OfficeQueue } from '../../core/outbox/office-queue';
import { adminRoutes } from '../admin.routes';
import { OFFICE_QUEUE } from '../office-sync';

// Spec: backlog V.3 — les indicateurs du suivi ; cahier des charges « L'onglet Suivi d'un lot »
// (d'après bureau-admin.html, onglet Suivi) : trois chiffres en tête, le graphe du poids, l'aliment
// face à la souche et l'indice, les ventes dès la première ; un chiffre sans donnée reste à blanc.

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
// The figures of the server's test (tracking.integration.spec.ts), computed by hand there.
const suivi = (fields: Partial<TrackingView> = {}): TrackingView => ({
  campaignId: BANDE,
  currency: 'XOF',
  strain: 'Cobb500',
  campaignDay: 23,
  plannedDuration: 45,
  costPerBird: 591,
  received: 1000,
  deaths: 62,
  mortality: 0.062,
  feed: { bagsOpened: 18, cumulative: 933, target: 1301, variance: -368, feedConversion: { campaignDay: 21, value: 1.098, target: 1.261 } },
  curve: [{ weighingId: uuid(207), campaignDay: 21, average: 850 }],
  sales: null,
  ...fields,
});
const VIDE: Partial<TrackingView> = {
  campaignDay: 0,
  plannedDuration: 42,
  costPerBird: null,
  received: 0,
  deaths: 0,
  mortality: null,
  feed: { bagsOpened: 0, cumulative: null, target: null, variance: null, feedConversion: null },
  curve: [],
  sales: null,
};

describe('Le suivi d’un lot, au bureau', () => {
  let http: HttpTestingController;

  const ouvre = async (url: string, view: TrackingView | 'no-network' = suivi()) => {
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
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    const refresh = async () => {
      await settle();
      http.match('/api/v1/caretaker/context').forEach((request) => request.flush(contexte()));
      http.match(`/api/v1/campaigns/${BANDE}/tracking`).forEach((request) => (view === 'no-network' ? request.error(new ProgressEvent('error')) : request.flush(view)));
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
    return { element, tap };
  };
  const text = (node: Element | null | undefined) => node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('yaar.session', JSON.stringify({ token, expiresAt: '2099-01-01T00:00:00.000Z', role: 'admin', account: { name: 'Bassirou', avatar: 'baobab', language: 'fr' } }));
  });

  it('les lots mènent au suivi', async () => {
    const { tap } = await ouvre('/admin/lots');

    await tap('a.tracking');
    expect(TestBed.inject(Router).url).toBe('/admin/lots/suivi');
  });

  it('trois chiffres en tête : le coût par poulet, la mortalité au dixième de pourcent, le jour sur la durée prévue', async () => {
    const { element } = await ouvre('/admin/lots/suivi');

    // 62 ÷ 1 000 = 6,2 %
    expect(text(element().querySelector('.kpi.cost'))).toBe('591 F coût par poulet');
    expect(text(element().querySelector('.kpi.mortality'))).toBe('6,2 % mortalité 62 morts sur 1 000');
    expect(text(element().querySelector('.kpi.days'))).toBe('J23/45 jours');
    // Une espace insécable entre les milliers : « 1 000 » ne se coupe jamais en fin de ligne (vu à 360 px)
    expect(element().querySelector('.kpi.mortality .detail')?.textContent).toBe('62 morts sur 1\u00a0000');
  });

  it('le graphe du poids, avec les pesées validées du lot et la souche', async () => {
    const { element } = await ouvre('/admin/lots/suivi');

    expect(element().querySelectorAll('app-weight-chart circle')).toHaveLength(1);
    expect(element().querySelector('app-weight-chart .target')).not.toBeNull();
  });

  it('l’aliment : le cumul par poulet face à la table, l’écart en grammes et en pourcentage, les sacs comptés', async () => {
    const { element } = await ouvre('/admin/lots/suivi');

    // −368 ÷ 1 301 = −28,3 % → −28 %
    expect(text(element().querySelector('.feed .cumulative'))).toBe('Cumul par poulet : 933 g contre 1 301 g dans la table Cobb 500 à J23 −368 g · −28 %');
    expect(text(element().querySelector('.feed .bags'))).toBe('18 sacs de 50 kg comptés');
  });

  it('l’indice de consommation face au guide : plus bas que le guide, il est meilleur que la table, en vert', async () => {
    const { element } = await ouvre('/admin/lots/suivi');
    const indice = element().querySelector('.feed .conversion');

    expect(text(indice)).toBe('Indice de consommation à J21 : 1,10 contre 1,26 au guide meilleur que la table');
    expect(indice?.querySelector('.badge')?.classList.contains('better')).toBe(true);
  });

  it('plus haut que le guide, l’indice se montre en orange ; au-dessus de la table, l’écart du cumul est signé +', async () => {
    const { element } = await ouvre('/admin/lots/suivi', suivi({ feed: { bagsOpened: 30, cumulative: 1450, target: 1301, variance: 149, feedConversion: { campaignDay: 21, value: 1.42, target: 1.261 } } }));

    // +149 ÷ 1 301 = +11,5 % → +11 %
    expect(text(element().querySelector('.feed .cumulative .gap'))).toBe('+149 g · +11 %');
    expect(text(element().querySelector('.feed .conversion .badge'))).toBe('plus que la table');
    expect(element().querySelector('.feed .conversion .badge')?.classList.contains('worse')).toBe(true);
    expect(element().querySelector('.feed .conversion .badge')?.classList.contains('better')).toBe(false);
  });

  it('un lot sans rien encore : chaque chiffre sans donnée reste à blanc, jamais zéro ; pas de ventes', async () => {
    const { element } = await ouvre('/admin/lots/suivi', suivi(VIDE));

    expect(text(element().querySelector('.kpi.cost'))).toBe('— coût par poulet');
    expect(text(element().querySelector('.kpi.mortality'))).toBe('— mortalité aucun poussin reçu');
    expect(text(element().querySelector('.kpi.days'))).toBe('J0/42 jours');
    expect(text(element().querySelector('.feed .cumulative'))).toBe('Cumul par poulet : — (aucun poussin reçu)');
    expect(text(element().querySelector('.feed .conversion'))).toBe('Indice de consommation : — (aucune pesée validée)');
    expect(element().querySelector('.sales')).toBeNull();
  });

  it('avant J7 la table ne donne pas de cumul : le cumul s’affiche seul, sans écart', async () => {
    const { element } = await ouvre('/admin/lots/suivi', suivi({ campaignDay: 4, feed: { bagsOpened: 2, cumulative: 100, target: null, variance: null, feedConversion: null } }));

    expect(text(element().querySelector('.feed .cumulative'))).toBe('Cumul par poulet : 100 g (la table ne donne pas ce jour)');
  });

  it('dès la première vente : la marge, le prix moyen et le restant à vendre ; rien de cela avant', async () => {
    const { element } = await ouvre('/admin/lots/suivi', suivi({ sales: { margin: -350_000, averagePrice: 2_000, remaining: 838 } }));

    expect(text(element().querySelector('.sales .margin'))).toBe('Marge -350 000 F');
    expect(element().querySelector('.sales .margin strong')?.classList.contains('negative')).toBe(true);
    expect(text(element().querySelector('.sales .average'))).toBe('Prix moyen 2 000 F le poulet');
    expect(text(element().querySelector('.sales .remaining'))).toBe('Restant à vendre 838 poulets');
  });

  it('sans réseau et sans lecture gardée, l’écran le dit au lieu de chiffres vides', async () => {
    const { element } = await ouvre('/admin/lots/suivi', 'no-network');

    expect(text(element().querySelector('.unreachable'))).toBe('Pas de réseau : le suivi n’a pas encore été lu. Réessaie plus tard.');
    expect(element().querySelector('.kpi')).toBeNull();
  });
});
