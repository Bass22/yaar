import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { IDBFactory } from 'fake-indexeddb';
import type { CaretakerContext } from '@contracts';
import { provideHeardVoice } from '../../core/audio/testing';
import { CLOCK } from '../../core/clock';
import { OfficeQueue } from '../../core/outbox/office-queue';
import { adminRoutes } from '../admin.routes';
import { OFFICE_QUEUE } from '../office-sync';

// Spec: backlog O.6 (question du fondateur du 2026-11-13) et bureau-admin-v2.html « Changer de
// lot » : le lot se choisit une fois et se garde ; chaque page d'un lot le nomme ; on le change
// quand on veut ; « Écrire » part du lot où l'on est.

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT = uuid(10);
const LE_GERANT = uuid(54);
const NORD = uuid(3);
const SUD = uuid(8);
const BANDE_NORD = uuid(4);
const BANDE_SUD = uuid(6);
const token = (sub = LE_GERANT) => `e30.${btoa(JSON.stringify({ sub, tenant: TENANT })).replace(/=+$/, '')}.c2ln`;
const NOW = new Date('2026-11-04T10:00:00.000Z');
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

const lot = (campaignId: string, campaignDay: number) => ({ campaignId, placementDay: '2026-10-12', campaignDay, liveCount: 900, journal: [], deliveries: [], weighingRequests: [], strain: 'Cobb500' });
const contexte = (): CaretakerContext => ({
  chef: null,
  sites: [
    { siteId: NORD, name: 'Poulailler Nord', timeZone: 'Africa/Dakar', today: '2026-11-04', primaryCaretakerId: null, campaigns: [lot(BANDE_NORD, 23)] },
    { siteId: SUD, name: 'Poulailler Sud', timeZone: 'Africa/Dakar', today: '2026-11-04', primaryCaretakerId: null, campaigns: [lot(BANDE_SUD, 15)] },
  ],
});

describe('Le lot du bureau, choisi une fois', () => {
  const ouvre = async (url: string, context: CaretakerContext = contexte()) => {
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
    const http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    const refresh = async () => {
      await settle();
      http.match('/api/v1/caretaker/context').forEach((request) => request.flush(context));
      // What the pages read beyond the lots does not matter here: none answers.
      http.match(() => true).forEach((request) => request.flush(null, { status: 404, statusText: 'Not Found' }));
      harness.detectChanges();
      await harness.fixture.whenStable();
      harness.detectChanges();
    };
    const go = async (to: string) => {
      await harness.navigateByUrl(to);
      await refresh();
      await refresh();
    };
    await go(url);
    const element = () => harness.routeNativeElement?.closest('app-office-shell') as HTMLElement;
    const tap = async (selector: string) => {
      const target = element().querySelector<HTMLElement>(selector);
      if (target === null) throw new Error(`Nothing to tap: ${selector}`);
      target.click();
      await refresh();
    };
    return { element, tap, go };
  };
  const text = (node: Element | null | undefined) => node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const session = (sub = LE_GERANT) => JSON.stringify({ token: token(sub), expiresAt: '2099-01-01T00:00:00.000Z', role: 'admin', account: { name: 'Bassirou', avatar: 'baobab', language: 'fr' } });

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('yaar.session', session());
  });

  it('chaque page d’un lot le nomme ; sans choix, c’est le premier lot', async () => {
    const { element } = await ouvre('/admin/lots/suivi');

    expect(text(element().querySelector('app-current-lot .name'))).toBe('Poulailler Nord · Jour 23');
  });

  it('changé sur une page, le lot reste le même sur les autres : suivi, budget, ventes, pesées, dépenses', async () => {
    const { element, tap, go } = await ouvre('/admin/lots/suivi');

    await tap('app-current-lot button.change');
    await tap(`app-current-lot input[name=lot]:not(:checked)`);
    expect(text(element().querySelector('app-current-lot .name'))).toBe('Poulailler Sud · Jour 15');
    // Gardé sur l'appareil, pour la personne qui l'a choisi
    expect(JSON.parse(localStorage.getItem('yaar.office.lot') ?? 'null')).toEqual({ userId: LE_GERANT, campaignId: BANDE_SUD });

    for (const page of ['/admin/lots/budget', '/admin/lots/ventes', '/admin/lots/pesees', '/admin/achats/depenses', '/admin/lots/cloture']) {
      await go(page);
      expect(text(element().querySelector('app-current-lot .name'))).toBe('Poulailler Sud · Jour 15');
    }
  });

  it('toucher un lot dans « Lots » en fait le lot de travail, marqué', async () => {
    const { element, tap, go } = await ouvre('/admin/lots');

    await tap('.lot:not(.current)');
    expect(text(element().querySelector('.lot.current .where'))).toBe('Poulailler Sud');
    await go('/admin/lots/suivi');
    expect(text(element().querySelector('app-current-lot .name'))).toBe('Poulailler Sud · Jour 15');
  });

  it('le choix se garde pour la prochaine ouverture, pour la même personne seulement', async () => {
    localStorage.setItem('yaar.office.lot', JSON.stringify({ userId: LE_GERANT, campaignId: BANDE_SUD }));
    const meme = await ouvre('/admin/lots/suivi');
    expect(text(meme.element().querySelector('app-current-lot .name'))).toBe('Poulailler Sud · Jour 15');

    TestBed.resetTestingModule();
    localStorage.setItem('yaar.session', session(uuid(55)));
    const autre = await ouvre('/admin/lots/suivi');
    expect(text(autre.element().querySelector('app-current-lot .name'))).toBe('Poulailler Nord · Jour 23');
  });

  it('« Écrire » une dépense part du lot de travail, même quand il y en a plusieurs ; un autre lot reste au choix', async () => {
    localStorage.setItem('yaar.office.lot', JSON.stringify({ userId: LE_GERANT, campaignId: BANDE_SUD }));
    const { element } = await ouvre('/admin/achats/depense');

    expect(element().querySelector<HTMLInputElement>('input[name=lot]:checked')?.closest('label')?.textContent).toContain('Poulailler Sud');
    expect(element().querySelectorAll('input[name=lot]')).toHaveLength(2);
  });

  it('un seul lot en cours : il est le lot de travail, sans « Changer de lot » ; avec deux, le bouton est là', async () => {
    const seul = await ouvre('/admin/lots/suivi', { chef: null, sites: [contexte().sites[0]!] });
    expect(text(seul.element().querySelector('app-current-lot .name'))).toBe('Poulailler Nord · Jour 23');
    expect(seul.element().querySelector('app-current-lot button.change')).toBeNull();

    TestBed.resetTestingModule();
    const deux = await ouvre('/admin/lots/suivi');
    expect(deux.element().querySelector('app-current-lot button.change')).not.toBeNull();
  });
});
