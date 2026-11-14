import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { CaretakerContext, CaretakerSite, OpenCampaignRequest } from '@contracts';
import { CLOCK } from '../../core/clock';
import { adminRoutes } from '../admin.routes';

// Spec: backlog O.2 — ouvrir une campagne ; cahier des charges « Ouvrir une bande » (décisions du
// 2026-11-09 : souche préremplie à Cobb 500 à la demande du fondateur, date à aujourd'hui, durée à
// 45 jours ; jamais de mise en place future ni de plus de 60 jours) ; CLAUDE.md §4 règle 3 (le
// bureau demande le réseau) et §3 (la règle s'écrit une fois, dans le domaine). Le bureau est monté
// sous /admin, comme dans l'application : un lien écrit en dur depuis la racine s'y perdrait.

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT = uuid(10);
const LE_GERANT = uuid(54);
const NORD = uuid(3);
const SUD = uuid(30);
const token = `e30.${btoa(JSON.stringify({ sub: LE_GERANT, tenant: TENANT })).replace(/=+$/, '')}.c2ln`;
// Friday November 6th, 2026, 08:00 in Dakar.
const NOW = new Date('2026-11-06T08:00:00.000Z');
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

const unSite = (siteId: string, name: string): CaretakerSite => ({ siteId, name, timeZone: 'Africa/Dakar', today: '2026-11-06', primaryCaretakerId: null, campaigns: [] });
const contexte = (sites: CaretakerSite[] = [unSite(NORD, 'Poulailler Nord')]): CaretakerContext => ({ chef: null, sites });

describe('Ouvrir une bande, au bureau', () => {
  let http: HttpTestingController;

  const ouvre = async (context: CaretakerContext = contexte(), url = '/admin/lots/ouvrir') => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([{ path: 'admin', children: adminRoutes }]), { provide: CLOCK, useValue: { now: () => NOW } }],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    http.expectOne('/api/v1/caretaker/context').flush(context);
    const refresh = async () => {
      await settle();
      harness.detectChanges();
      await harness.fixture.whenStable();
      harness.detectChanges();
    };
    await refresh();
    const element = () => harness.routeNativeElement?.closest('app-office-shell') as HTMLElement;
    const field = <T extends HTMLElement>(selector: string) => {
      const found = element().querySelector<T>(selector);
      if (found === null) throw new Error(`No field: ${selector}`);
      return found;
    };
    const type = async (selector: string, value: string) => {
      const input = field<HTMLInputElement | HTMLSelectElement>(selector);
      input.value = value;
      input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input'));
      await refresh();
    };
    const submit = async () => {
      field<HTMLButtonElement>('form button[type=submit]').click();
      await refresh();
    };
    const soon = (check: () => void) => vi.waitFor(async () => {
      await refresh();
      check();
    });
    return { harness, element, field, type, submit, refresh, soon };
  };
  const posted = () => http.match((request) => request.method === 'POST' && request.url === '/api/v1/campaigns');

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('yaar.session', JSON.stringify({ token, expiresAt: '2099-01-01T00:00:00.000Z', role: 'admin', account: { name: 'Bassirou', avatar: 'baobab', language: 'fr' } }));
  });

  it('« Annuler » revient à Lots, sans rien envoyer', async () => {
    const { element, refresh } = await ouvre();

    element().querySelector<HTMLAnchorElement>('.actions a')?.click();
    await refresh();

    expect(TestBed.inject(Router).url).toBe('/admin/lots');
    expect(posted()).toEqual([]);
  });

  it('Lots mène à « Ouvrir une bande »', async () => {
    const { element, refresh } = await ouvre(contexte(), '/admin/lots');

    const link = element().querySelector<HTMLAnchorElement>('a.open-campaign');
    expect(link?.textContent).toContain('Ouvrir une bande');
    link?.click();
    await refresh();
    expect(TestBed.inject(Router).url).toBe('/admin/lots/ouvrir');
  });

  it('le formulaire arrive prérempli : le seul site, la souche Cobb 500, la mise en place aujourd’hui, 45 jours ; l’effectif reste à écrire, jamais un zéro', async () => {
    const { field } = await ouvre();

    expect(field<HTMLInputElement>('input[name=site]:checked').value).toBe(NORD);
    expect(field<HTMLInputElement>('input[name=strain]:checked').value).toBe('Cobb500');
    expect(field<HTMLInputElement>('input[name=strain]:checked').closest('label')?.textContent).toContain('Cobb 500');
    expect(field<HTMLInputElement>('input[name=placementDay]').value).toBe('2026-11-06');
    expect(field<HTMLInputElement>('input[name=plannedDuration]').value).toBe('45');
    expect(field<HTMLInputElement>('input[name=plannedHeadcount]').value).toBe('');
  });

  it('l’effectif dit son unité une seule fois, collée à la case : « poussins »', async () => {
    const { field } = await ouvre();
    const effectif = field<HTMLElement>('label.headcount .figure');

    expect(effectif.textContent?.match(/poussins/g)).toEqual(['poussins']);
    expect(effectif.querySelector('.affix')?.textContent?.trim()).toBe('poussins');
  });

  it('le choix d’un site se fait d’un tap sur sa tuile, et c’est lui qui part', async () => {
    const { element, type, submit, soon, refresh } = await ouvre(contexte([unSite(NORD, 'Poulailler Nord'), unSite(SUD, 'Poulailler Sud')]));
    element().querySelector<HTMLInputElement>(`input[name=site][value="${SUD}"]`)?.click();
    await refresh();
    await type('input[name=plannedHeadcount]', '800');

    await submit();

    await soon(() => expect((posted()[0]?.request.body as OpenCampaignRequest | undefined)?.siteId).toBe(SUD));
  });

  it('la durée se règle par − et +, de 1 à 60 jours', async () => {
    const { field, element, refresh, type } = await ouvre();

    field<HTMLButtonElement>('.duration .less').click();
    await refresh();
    expect(field<HTMLInputElement>('input[name=plannedDuration]').value).toBe('44');

    await type('input[name=plannedDuration]', '60');
    expect(field<HTMLButtonElement>('.duration .more').disabled).toBe(true);
    await type('input[name=plannedDuration]', '1');
    expect(field<HTMLButtonElement>('.duration .less').disabled).toBe(true);
    expect(element().querySelector('.refusal')).toBeNull();
  });

  // Spec: backlog O.5 (décision du 2026-11-13) — une bande s'ouvre jusqu'à 30 jours à l'avance
  it('le calendrier propose jusqu’à 30 jours à l’avance, et pas plus de 60 jours en arrière', async () => {
    const { field } = await ouvre();

    expect([field<HTMLInputElement>('input[name=placementDay]').max, field<HTMLInputElement>('input[name=placementDay]').min]).toEqual(['2026-12-06', '2026-09-07']);
  });

  it('avec deux sites, aucun n’est choisi d’avance : l’admin dit lequel, sinon rien ne part', async () => {
    const { submit, element } = await ouvre(contexte([unSite(NORD, 'Poulailler Nord'), unSite(SUD, 'Poulailler Sud')]));
    expect(element().querySelectorAll('input[name=site]')).toHaveLength(2);
    expect(element().querySelector('input[name=site]:checked')).toBeNull();

    await submit();

    expect(posted()).toEqual([]);
    expect(element().querySelector('.refusal')?.textContent).toContain('Choisis le site');
  });

  it('« Ouvrir la bande » envoie la bande au serveur, avec un identifiant créé ici ; ouverte, le bureau relit ses lots et revient à Lots, où elle est', async () => {
    const { type, submit, soon, element } = await ouvre();
    await type('input[name=plannedHeadcount]', '1000');

    await submit();

    let request: TestRequest | undefined;
    await soon(() => {
      request = posted()[0];
      expect(request).toBeDefined();
    });
    const body = request?.request.body as OpenCampaignRequest;
    expect(body).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), siteId: NORD, strain: 'Cobb500', plannedHeadcount: 1000, placementDay: '2026-11-06', plannedDuration: 45 });
    expect(request?.request.headers.get('Authorization')).toBe(`Bearer ${token}`);
    request?.flush(null, { status: 201, statusText: 'Created' });
    const nouvelleBande = { campaignId: body.id, placementDay: '2026-11-06', campaignDay: 0, liveCount: null, journal: [], deliveries: [], weighingRequests: [], strain: 'Cobb500' };
    await soon(() => {
      const reread = http.match('/api/v1/caretaker/context')[0];
      expect(reread).toBeDefined();
      reread?.flush(contexte([{ ...unSite(NORD, 'Poulailler Nord'), campaigns: [nouvelleBande] }]));
    });
    await soon(() => expect(TestBed.inject(Router).url).toBe('/admin/lots'));
    await soon(() => expect(element().querySelector('.lot')?.textContent).toMatch(/Poulailler Nord.*Jour 0/));
  });

  it('la règle du domaine refuse avant tout envoi, et le dit : un effectif nul, une durée de 61 jours', async () => {
    const { type, submit, element } = await ouvre();

    await type('input[name=plannedHeadcount]', '0');
    await submit();
    expect(element().querySelector('.refusal')?.textContent).toContain('au moins 1 poussin');

    await type('input[name=plannedHeadcount]', '1000');
    await type('input[name=plannedDuration]', '61');
    await submit();
    expect(element().querySelector('.refusal')?.textContent).toContain('de 1 à 60 jours');
    expect(posted()).toEqual([]);
  });

  it('un refus du serveur est dit, et le formulaire reste rempli', async () => {
    const { type, submit, soon, element, field } = await ouvre();
    await type('input[name=plannedHeadcount]', '1000');
    await submit();

    let request: TestRequest | undefined;
    await soon(() => {
      request = posted()[0];
      expect(request).toBeDefined();
    });
    // The site's day may have moved on the server: it judges, the office only helps.
    request?.flush({ kind: 'PlacementTooFarAhead' }, { status: 400, statusText: 'Bad Request' });

    await soon(() => expect(element().querySelector('.refusal')?.textContent).toContain('La mise en place est au plus dans 30 jours'));
    expect(field<HTMLInputElement>('input[name=plannedHeadcount]').value).toBe('1 000');
    expect(TestBed.inject(Router).url).toBe('/admin/lots/ouvrir');
  });

  it('sans réseau, la bande n’est pas ouverte, et il le dit', async () => {
    const { type, submit, soon, element, field } = await ouvre();
    await type('input[name=plannedHeadcount]', '1000');
    await submit();

    let request: TestRequest | undefined;
    await soon(() => {
      request = posted()[0];
      expect(request).toBeDefined();
    });
    request?.error(new ProgressEvent('error'));

    await soon(() => expect(element().querySelector('.refusal')?.textContent).toContain('Pas de réseau : la bande n’est pas ouverte'));
    expect(field<HTMLInputElement>('input[name=plannedHeadcount]').value).toBe('1 000');
    expect(TestBed.inject(Router).url).toBe('/admin/lots/ouvrir');
  });

  it('deux bandes ouvertes l’une après l’autre ont chacune leur identifiant', async () => {
    const { type, submit, soon, harness } = await ouvre();
    const ids: string[] = [];
    for (let opened = 0; opened < 2; opened++) {
      await harness.navigateByUrl('/admin/lots/ouvrir');
      await type('input[name=plannedHeadcount]', '1000');
      await submit();
      let request: TestRequest | undefined;
      await soon(() => {
        request = posted()[0];
        expect(request).toBeDefined();
      });
      ids.push((request?.request.body as OpenCampaignRequest).id);
      request?.flush(null, { status: 201, statusText: 'Created' });
      await soon(() => {
        const reread = http.match('/api/v1/caretaker/context')[0];
        expect(reread).toBeDefined();
        reread?.flush(contexte());
      });
      await soon(() => expect(TestBed.inject(Router).url).toBe('/admin/lots'));
    }

    expect(new Set(ids).size).toBe(2);
  });

  it('un double tap n’ouvre qu’une bande', async () => {
    const { type, field, soon } = await ouvre();
    await type('input[name=plannedHeadcount]', '1000');

    field<HTMLButtonElement>('form button[type=submit]').click();
    field<HTMLButtonElement>('form button[type=submit]').click();

    let requests: TestRequest[] = [];
    await soon(() => {
      requests = posted();
      expect(requests.length).toBeGreaterThan(0);
    });
    await settle();
    expect([...requests, ...posted()]).toHaveLength(1);
  });
});
