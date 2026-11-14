import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { CaretakerCampaign, CaretakerContext } from '@contracts';
import { CLOCK } from '../../core/clock';
import { adminRoutes } from '../admin.routes';

// Spec: backlog O.3 — la coquille du bureau ; cahier des charges « Architecture du bureau »
// (maquette bureau-admin-v2.html, validée le 2026-11-08) ; « Un bureau pour ceux qui ne lisent
// pas » (un picto d'objet réel et le mot) ; CLAUDE.md §4 règle 3 (le bureau montre la date de ses chiffres).

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT = uuid(10);
const LE_GERANT = uuid(54);
const token = `e30.${btoa(JSON.stringify({ sub: LE_GERANT, tenant: TENANT })).replace(/=+$/, '')}.c2ln`;
// Friday November 6th, 2026, 08:00 in Dakar.
const NOW = new Date('2026-11-06T08:00:00.000Z');
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

const uneBande = (fields: Partial<CaretakerCampaign> = {}): CaretakerCampaign => ({ campaignId: uuid(4), placementDay: '2026-10-15', campaignDay: 22, liveCount: 1898, journal: [], deliveries: [], weighingRequests: [], strain: 'Cobb500', ...fields });
const contexte = (): CaretakerContext => ({
  chef: { name: 'Le gérant', phone: '+221770000003' },
  sites: [
    { siteId: uuid(3), name: 'Poulailler Nord', timeZone: 'Africa/Dakar', today: '2026-11-06', primaryCaretakerId: null, campaigns: [uneBande()] },
    { siteId: uuid(30), name: 'Poulailler Sud', timeZone: 'Africa/Dakar', today: '2026-11-06', primaryCaretakerId: null, campaigns: [uneBande({ campaignId: uuid(40), campaignDay: 3, liveCount: null })] },
  ],
});

describe('La coquille du bureau', () => {
  const ouvre = async (url: string, answer: (request: ReturnType<HttpTestingController['expectOne']>) => void = (request) => request.flush(contexte())) => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter(adminRoutes), { provide: CLOCK, useValue: { now: () => NOW } }],
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    answer(TestBed.inject(HttpTestingController).expectOne('/api/v1/caretaker/context'));
    await settle();
    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();
    const element = harness.routeNativeElement?.closest('app-office-shell') ?? (harness.fixture.nativeElement as HTMLElement);
    return { harness, element: element as HTMLElement };
  };
  const entrees = (element: HTMLElement) => Array.from(element.querySelectorAll<HTMLElement>('nav.tabs a'));

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('yaar.session', JSON.stringify({ token, expiresAt: '2099-01-01T00:00:00.000Z', role: 'admin', account: { name: 'Bassirou', avatar: 'baobab', language: 'fr' } }));
  });

  it('le bureau s’ouvre sur l’accueil ; la barre du bas a cinq entrées — Accueil, Lots, Achats, Tiers, Plus —, chacune avec son picto et son mot', async () => {
    const { element } = await ouvre('/');

    expect(element.querySelector('h1')?.textContent).toContain('À traiter');
    expect(entrees(element).map((a) => a.textContent?.trim())).toEqual(['Accueil', 'Lots', 'Achats', 'Tiers', 'Plus']);
    expect(entrees(element).map((a) => a.querySelector('use')?.getAttribute('href')?.split('#')[1])).toEqual(['bell', 'barn', 'truck', 'coin', 'paper']);
    expect(element.querySelector('nav.tabs a.active')?.textContent?.trim()).toBe('Accueil');
    expect(element.querySelector('header')?.textContent).toContain('Le bureau de Bassirou');
  });

  it('Lots montre chaque lot en cours, avec son site, son jour et ses vivants ; des vivants inconnus le disent, jamais zéro', async () => {
    const { element } = await ouvre('/lots');

    const lots = Array.from(element.querySelectorAll('.lot')).map((lot) => lot.textContent?.replace(/\s+/g, ' ').trim());
    // Vu à 360 px le 2026-11-13 : « 1898 » s'écrivait collé ; une espace insécable entre les milliers
    expect(element.querySelector('.lot .alive')?.textContent?.trim()).toBe('1\u00a0898 vivants');
    expect(lots).toEqual([expect.stringMatching(/Poulailler Nord.*Jour 22.*1 898 vivants/), expect.stringMatching(/Poulailler Sud.*Jour 3.*vivants : aucun poussin reçu/)]);
    expect(element.querySelector('nav.tabs a.active')?.textContent?.trim()).toBe('Lots');
  });

  // Spec: backlog O.5 (décision du 2026-11-13) — une bande ouverte en avance se dit « dans N jours »
  it('une bande ouverte en avance se dit à venir : « dans 3 jours », jamais « Jour -3 »', async () => {
    const { element } = await ouvre('/lots', (request) => request.flush({ chef: null, sites: [{ siteId: uuid(3), name: 'Poulailler Nord', timeZone: 'Africa/Dakar', today: '2026-11-06', primaryCaretakerId: null, campaigns: [uneBande({ campaignDay: -3, liveCount: null })] }] }));

    expect(element.querySelector('.lot')?.textContent?.replace(/\s+/g, ' ')).toContain('dans 3 jours');
    expect(element.querySelector('.lot')?.textContent).not.toContain('Jour -3');
  });

  it('l’accueil montre les lots en cours, puis ce qui est à traiter — rien pour l’instant, et il le dit', async () => {
    const { element } = await ouvre('/accueil');

    expect(element.querySelectorAll('.lot')).toHaveLength(2);
    expect(element.querySelector('.nothing')?.textContent).toContain('Rien à traiter pour l’instant');
  });

  it('Plus mène aux réglages : « Sites et équipe »', async () => {
    const { element } = await ouvre('/plus');

    expect(element.querySelector('.settings')?.textContent).toContain('Sites et équipe');
  });

  it('sans réseau, le bureau montre la dernière lecture gardée, et dit de quand elle date', async () => {
    localStorage.setItem('yaar.office', JSON.stringify({ userId: LE_GERANT, readAt: '2026-11-05T17:30:00.000Z', context: contexte() }));

    const { element } = await ouvre('/lots', (request) => request.error(new ProgressEvent('error')));

    expect(element.querySelectorAll('.lot')).toHaveLength(2);
    expect(element.querySelector('.stale')?.textContent).toContain('Pas de réseau : chiffres lus le 5 nov. à 17:30');
  });

  it('une lecture réussie est gardée : ouvert ensuite sans réseau, le bureau la montre, datée', async () => {
    await ouvre('/lots');
    TestBed.resetTestingModule();

    const { element } = await ouvre('/lots', (request) => request.error(new ProgressEvent('error')));

    expect(element.querySelectorAll('.lot')).toHaveLength(2);
    expect(element.querySelector('.stale')?.textContent).toContain('chiffres lus le 6 nov. à 08:00');
  });

  it('la lecture gardée d’un autre compte n’est jamais montrée', async () => {
    localStorage.setItem('yaar.office', JSON.stringify({ userId: uuid(99), readAt: '2026-11-05T17:30:00.000Z', context: contexte() }));

    const { element } = await ouvre('/lots', (request) => request.error(new ProgressEvent('error')));

    expect(element.querySelectorAll('.lot')).toHaveLength(0);
  });
});
