import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { IDBFactory } from 'fake-indexeddb';
import type { CaretakerCampaign, CaretakerContext, CaretakerJournalLine } from '@contracts';
import { provideHeardVoice } from '../../core/audio/testing';
import { CLOCK } from '../../core/clock';
import { Outbox, OutboxUnavailable } from '../../core/outbox/outbox';
import { OUTBOX } from '../../core/sync/journal-sync';
import { NotebookPage } from '../notebook/notebook-page';

// Spec: backlog K.4 — « Rien perdu hier » ; cahier des charges « Rappel d'oubli » (les morts
// d'hier pas écrits, un sac ne compte pas : décision du 2026-11-08), « Le zéro est une
// déclaration » ; maquette journal-gardien.html (post-it .nudge).

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT = uuid(10);
const NORD = uuid(3);
const BANDE = uuid(4);
const OUSMANE = uuid(51);
const AWA = uuid(52);
const token = `e30.${btoa(JSON.stringify({ sub: OUSMANE, tenant: TENANT })).replace(/=+$/, '')}.c2ln`;
// Friday November 6th, 2026, 08:00 in Dakar: yesterday is the 5th.
const NOW = new Date('2026-11-06T08:00:00.000Z');
const HIER = '2026-11-05';
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

const uneBande = (fields: Partial<CaretakerCampaign> = {}): CaretakerCampaign => ({ campaignId: BANDE, placementDay: '2026-10-15', campaignDay: 22, liveCount: 938, journal: [], deliveries: [], weighingRequests: [], strain: 'Cobb500', ...fields });
const contexte = (bande: CaretakerCampaign = uneBande()): CaretakerContext => ({
  chef: null,
  sites: [{ siteId: NORD, name: 'Poulailler Nord', timeZone: 'Africa/Dakar', today: '2026-11-06', primaryCaretakerId: OUSMANE, campaigns: [bande] }],
});
const ecritParAwa = (fact: CaretakerJournalLine['fact'], businessDate = HIER): CaretakerJournalLine => ({
  id: uuid(1), businessDate, recordedAt: `${businessDate}T07:00:00.000Z`, author: { id: AWA, name: 'Awa' }, fact, corrected: false, retracted: false,
});

describe('Le rappel « Rien perdu hier »', () => {
  let outbox: Outbox;
  let heard: string[][];

  const ouvre = async (context: CaretakerContext = contexte(), outboxProvider: { useValue: Promise<Outbox> } | { useFactory: () => Promise<Outbox> } = { useValue: Promise.resolve(outbox) }) => {
    const voice = provideHeardVoice(['nothing-lost-reminder', 'nothing-lost-done', 'past-day-yesterday', 'storage-full']);
    heard = voice.heard;
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: OUTBOX, ...outboxProvider }, { provide: CLOCK, useValue: { now: () => NOW } }, ...voice.providers],
    });
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(NotebookPage);
    fixture.detectChanges();
    http.expectOne('/api/v1/caretaker/context').flush(context);
    const element = fixture.nativeElement as HTMLElement;
    const refresh = async () => {
      await settle();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    const tape = async (selector: string) => {
      const target = element.querySelector<HTMLElement>(selector);
      if (target === null) {
        throw new Error(`Nothing to tap: ${selector}`);
      }
      target.click();
      await refresh();
    };
    await refresh();
    const soon = (check: () => void | Promise<void>) => vi.waitFor(async () => {
      await refresh();
      await check();
    });
    return { element, tape, soon };
  };
  const rappel = (element: HTMLElement) => element.querySelector('app-nothing-lost-reminder .nudge');
  const ecrits = async () => (await outbox.entriesOf(BANDE)).map((entry) => entry.payload);

  beforeEach(async () => {
    localStorage.clear();
    localStorage.setItem('yaar.session', JSON.stringify({ token, expiresAt: '2099-01-01T00:00:00.000Z', role: 'collaborator', account: { name: 'Ousmane', avatar: 'baobab', language: 'wo' } }));
    outbox = await Outbox.open(new IDBFactory());
  });

  it('les morts d’hier ne sont pas écrits : le post-it le dit, avec ses deux boutons, et le haut-parleur dit le rappel', async () => {
    const { element, tape, soon } = await ouvre();

    expect(rappel(element)?.textContent).toContain('Pour hier, les morts ne sont pas écrits.');
    expect(rappel(element)?.querySelector('.zero')?.textContent).toContain('Rien perdu hier');
    expect(rappel(element)?.querySelector('.go')?.textContent).toContain('Écrire pour hier');
    await tape('app-nothing-lost-reminder app-speaker-button button');
    await soon(() => expect(heard.at(-1)).toEqual(['wo/nothing-lost-reminder']));
  });

  it('un sac ouvert écrit hier ne fait pas disparaître le rappel : il manque toujours les morts', async () => {
    const { element } = await ouvre(contexte(uneBande({ journal: [ecritParAwa({ type: 'BagOpened', quantity: 2 })] })));

    expect(rappel(element)).not.toBeNull();
  });

  it('des morts écrits hier, même par un autre, ou un « rien perdu » d’hier : pas de rappel', async () => {
    const avecMorts = await ouvre(contexte(uneBande({ journal: [ecritParAwa({ type: 'Death', quantity: 1 })] })));
    expect(rappel(avecMorts.element)).toBeNull();
    TestBed.resetTestingModule();

    const avecZero = await ouvre(contexte(uneBande({ journal: [ecritParAwa({ type: 'NoLoss' })] })));
    expect(rappel(avecZero.element)).toBeNull();
  });

  it('des morts d’avant-hier ne comptent pas pour hier : le rappel reste', async () => {
    const { element } = await ouvre(contexte(uneBande({ journal: [ecritParAwa({ type: 'Death', quantity: 1 }, '2026-11-04')] })));

    expect(rappel(element)).not.toBeNull();
  });

  it('une bande mise en place aujourd’hui n’existait pas hier : pas de rappel', async () => {
    const { element } = await ouvre(contexte(uneBande({ placementDay: '2026-11-06', campaignDay: 0 })));

    expect(rappel(element)).toBeNull();
  });

  it('« Rien perdu hier » écrit en un tap un zéro daté d’hier, à l’heure du téléphone : tampon, voix, et le rappel disparaît', async () => {
    const { element, tape, soon } = await ouvre();

    await tape('app-nothing-lost-reminder .zero');

    await soon(async () => expect(await ecrits()).toEqual([{ id: expect.any(String), siteId: NORD, campaignId: BANDE, businessDate: HIER, recordedAt: '2026-11-06T08:00:00.000Z', fact: { type: 'NoLoss' } }]));
    await soon(() => expect(element.querySelector('app-nothing-lost-reminder app-stamp .stamp')?.textContent).toContain('C’est noté'));
    await soon(() => expect(heard.at(-1)).toEqual(['wo/nothing-lost-done']));
    await soon(() => expect(rappel(element)).toBeNull());
  });

  it('un double tap sur « Rien perdu hier » n’écrit qu’un zéro', async () => {
    const { element, soon } = await ouvre();
    const zero = element.querySelector<HTMLElement>('app-nothing-lost-reminder .zero');
    zero?.click();
    zero?.click();

    await soon(() => expect(element.querySelector('app-nothing-lost-reminder app-stamp .stamp')).not.toBeNull());
    expect(await ecrits()).toHaveLength(1);
  });

  it('« Écrire pour hier » ouvre le cahier sur hier, la voix prévient, et le rappel s’efface', async () => {
    const { element, tape, soon } = await ouvre();

    await tape('app-nothing-lost-reminder .go');

    expect(element.querySelector('.past')?.textContent).toContain('HIER');
    expect(rappel(element)).toBeNull();
    expect(await ecrits()).toEqual([]);
    await soon(() => expect(heard.at(-1)).toEqual(['wo/past-day-yesterday']));
  });

  it('le téléphone ne peut pas garder le zéro : pas de tampon, le post-it et la voix le disent, et le rappel reste', async () => {
    const { element, tape, soon } = await ouvre(contexte(), { useFactory: () => Promise.reject(new OutboxUnavailable(new Error('quota'))) });

    await tape('app-nothing-lost-reminder .zero');

    await soon(() => expect(element.querySelector('app-nothing-lost-reminder .failed')?.textContent).toContain('Le téléphone n’arrive plus à garder'));
    expect(element.querySelector('app-nothing-lost-reminder app-stamp .stamp')).toBeNull();
    expect(rappel(element)).not.toBeNull();
    await soon(() => expect(heard.at(-1)).toEqual(['wo/storage-full']));
  });
});
