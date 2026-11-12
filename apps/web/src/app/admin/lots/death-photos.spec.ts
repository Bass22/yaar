import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { IDBFactory } from 'fake-indexeddb';
import type { CaretakerContext, DeathPhotosView } from '@contracts';
import { provideHeardVoice } from '../../core/audio/testing';
import { CLOCK } from '../../core/clock';
import { OfficeQueue } from '../../core/outbox/office-queue';
import { adminRoutes } from '../admin.routes';
import { OFFICE_QUEUE } from '../office-sync';

// Spec: backlog K.6 — le bureau voit, par gardien, la part des morts photographiés ; cahier des
// charges « Photo des morts » (décision du 2026-11-12 : sur la page des lots, les déclarations sans
// réponse à part).

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT = uuid(10);
const LE_GERANT = uuid(54);
const NORD = uuid(3);
const BANDE = uuid(4);
const token = `e30.${btoa(JSON.stringify({ sub: LE_GERANT, tenant: TENANT })).replace(/=+$/, '')}.c2ln`;
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
const contexte = (): CaretakerContext => ({
  chef: null,
  sites: [{ siteId: NORD, name: 'Poulailler Nord', timeZone: 'Africa/Dakar', today: '2026-11-12', primaryCaretakerId: null, campaigns: [{ campaignId: BANDE, placementDay: '2026-10-12', campaignDay: 31, liveCount: 980, journal: [], deliveries: [], weighingRequests: [], strain: 'Cobb500' }] }],
});

describe('Les morts photographiés, au bureau', () => {
  const ouvre = async (view: DeathPhotosView) => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: 'admin', children: adminRoutes }]),
        { provide: CLOCK, useValue: { now: () => new Date('2026-11-12T10:00:00.000Z') } },
        { provide: OFFICE_QUEUE, useFactory: () => OfficeQueue.open(new IDBFactory()) },
        ...provideHeardVoice([]).providers,
      ],
    });
    const http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/admin/lots');
    for (let round = 0; round < 3; round += 1) {
      await settle();
      http.match('/api/v1/caretaker/context').forEach((request) => request.flush(contexte()));
      http.match(`/api/v1/campaigns/${BANDE}/death-photos`).forEach((request) => request.flush(view));
      harness.detectChanges();
      await harness.fixture.whenStable();
      harness.detectChanges();
    }
    return harness.routeNativeElement?.closest('app-office-shell') as HTMLElement;
  };
  const text = (node: Element) => node.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('yaar.session', JSON.stringify({ token, expiresAt: '2099-01-01T00:00:00.000Z', role: 'admin', account: { name: 'Bassirou', avatar: 'baobab', language: 'fr' } }));
  });

  it('par gardien : combien de ses déclarations de morts sont photographiées, sur combien de répondues ; celles sans réponse à part', async () => {
    const element = await ouvre({
      campaignId: BANDE,
      caretakers: [
        { authorId: uuid(52), name: 'Modou', photographed: 1, noPhoto: 0, unanswered: 1 },
        { authorId: uuid(51), name: 'Ousmane', photographed: 1, noPhoto: 2, unanswered: 0 },
      ],
    });

    expect(Array.from(element.querySelectorAll('.death-photos li')).map(text)).toEqual(['Modou 1 sur 1 en photo · 1 sans réponse', 'Ousmane 1 sur 3 en photo']);
  });

  it('aucune déclaration de morts : la page le dit', async () => {
    const element = await ouvre({ campaignId: BANDE, caretakers: [] });

    expect(text(element.querySelector('.death-photos')!)).toContain('Aucun mort déclaré pour ce lot.');
  });
});
