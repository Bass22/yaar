import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { IDBFactory } from 'fake-indexeddb';
import type { CaretakerContext, CorrectionToReview } from '@contracts';
import { CLOCK } from '../../core/clock';
import { OfficeQueue } from '../../core/outbox/office-queue';
import { adminRoutes } from '../admin.routes';
import { OFFICE_QUEUE } from '../office-sync';

// Spec: backlog Y.2b — chaque notification a sa carte dans « À traiter » : une correction d'un
// gardien jusqu'à « Vu » (décision du fondateur du 2026-11-14), des morts au-delà des vivants tant
// que les vivants sont sous zéro. La carte existe même sans push.

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const token = `e30.${btoa(JSON.stringify({ sub: uuid(54), tenant: uuid(10) })).replace(/=+$/, '')}.c2ln`;
const NORD = uuid(3);
const BANDE = uuid(4);
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

const contexte = (liveCount: number | null): CaretakerContext => ({
  chef: null,
  sites: [{ siteId: NORD, name: 'Poulailler Nord', timeZone: 'Africa/Dakar', today: '2026-11-14', primaryCaretakerId: null, campaigns: [{ campaignId: BANDE, placementDay: '2026-11-02', campaignDay: 12, liveCount, journal: [], deliveries: [], weighingRequests: [], strain: 'Cobb500' }] }],
});
const uneCorrection = (fields: Partial<CorrectionToReview> = {}): CorrectionToReview => ({
  correctionId: uuid(102),
  campaignId: BANDE,
  siteId: NORD,
  siteName: 'Poulailler Nord',
  businessDate: '2026-11-14',
  campaignDay: 12,
  authorName: 'Ousmane',
  before: '3 morts',
  after: '5 morts',
  recordedAt: '2026-11-14T09:00:00.000Z',
  ...fields,
});

describe('« À traiter », à l’accueil du bureau', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('yaar.session', JSON.stringify({ token, expiresAt: '2099-01-01T00:00:00.000Z', role: 'admin', account: { name: 'Le gérant', avatar: 'baobab', language: 'fr' } }));
  });

  const ouvre = async (corrections: CorrectionToReview[], liveCount: number | null = 900) => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([{ path: 'admin', children: adminRoutes }]), { provide: CLOCK, useValue: { now: () => new Date('2026-11-14T10:00:00.000Z') } }, { provide: OFFICE_QUEUE, useFactory: () => OfficeQueue.open(new IDBFactory()) }],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/admin/accueil');
    let current = corrections;
    const refresh = async () => {
      await settle();
      http.match('/api/v1/caretaker/context').forEach((request) => request.flush(contexte(liveCount)));
      http.match({ method: 'GET', url: '/api/v1/corrections/to-review' }).forEach((request) => request.flush(current));
      http.match('/api/v1/receptions').forEach((request) => request.flush({ today: '2026-11-14', receptions: [] }));
      http.match('/api/v1/orders').forEach((request) => request.flush([]));
      http.match({ method: 'GET', url: '/api/v1/counterparties' }).forEach((request) => request.flush([]));
      http.match('/api/v1/cost-types').forEach((request) => request.flush([]));
      await settle();
      harness.detectChanges();
      await harness.fixture.whenStable();
      harness.detectChanges();
    };
    await refresh();
    await refresh();
    const element = () => harness.routeNativeElement?.closest('app-office-shell') as HTMLElement;
    const text = (selector: string) => element().querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
    return { element, text, refresh, seen: (next: CorrectionToReview[]) => (current = next) };
  };

  it('une correction d’un gardien attend : le site, le jour, avant → après, l’auteur, un lien vers le journal du lot, et « Vu »', async () => {
    const { element, text } = await ouvre([uneCorrection()]);

    expect(text('.correction')).toContain('Correction : Poulailler Nord, J12 — 3 morts → 5 morts, par Ousmane');
    expect(element().querySelector('.correction a')?.getAttribute('href')).toBe(`/admin/lots/journal?lot=${BANDE}`);
    expect(element().querySelector('.correction button.seen')?.textContent?.trim()).toBe('Vu');
    expect(element().querySelector('.nothing')).toBeNull();
  });

  it('« Vu » le dit au serveur, et la carte s’en va ; rien d’autre ne reste à traiter', async () => {
    const { element, refresh, seen } = await ouvre([uneCorrection()]);

    (element().querySelector('.correction button.seen') as HTMLButtonElement).click();
    await settle();
    const review = http.expectOne({ method: 'POST', url: `/api/v1/corrections/${uuid(102)}/review` });
    review.flush(null, { status: 204, statusText: 'No Content' });
    seen([]);
    await refresh();

    expect(element().querySelector('.correction')).toBeNull();
    expect(element().querySelector('.nothing')).not.toBeNull();
  });

  it('« Vu » sans réseau : la carte reste, rien ne se perd', async () => {
    const { element, refresh } = await ouvre([uneCorrection()]);

    (element().querySelector('.correction button.seen') as HTMLButtonElement).click();
    await settle();
    http.expectOne({ method: 'POST', url: `/api/v1/corrections/${uuid(102)}/review` }).error(new ProgressEvent('offline'), { status: 0 });
    await refresh();

    expect(element().querySelector('.correction')).not.toBeNull();
  });

  it('des morts au-delà des vivants : une carte, l’écart signé, vers le journal ; tant que les vivants restent au-dessus de zéro, rien', async () => {
    const trop = await ouvre([], -2);
    expect(trop.text('.too-many-deaths')).toContain('Plus de morts que de vivants : Poulailler Nord, J12 — vivants −2');
    expect(trop.element().querySelector('.too-many-deaths a')?.getAttribute('href')).toBe(`/admin/lots/journal?lot=${BANDE}`);

    TestBed.resetTestingModule();
    const assez = await ouvre([], 0);
    expect(assez.element().querySelector('.too-many-deaths')).toBeNull();
  });
});
