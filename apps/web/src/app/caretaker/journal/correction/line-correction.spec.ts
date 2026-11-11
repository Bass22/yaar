import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { IDBFactory } from 'fake-indexeddb';
import type { CaretakerCampaign, CaretakerContext, CaretakerJournalLine, JournalBatchRequest } from '@contracts';
import { provideHeardVoice } from '../../../core/audio/testing';
import { CLOCK } from '../../../core/clock';
import { Outbox } from '../../../core/outbox/outbox';
import { OUTBOX } from '../../../core/sync/journal-sync';
import { NotebookPage } from '../../notebook/notebook-page';

// Spec: backlog K.5 — corriger une déclaration ; cahier des charges « Corrections » (libre tant
// que la déclaration n'a jamais quitté le téléphone, verrouillée pendant un envoi en doute, puis
// contre-déclaration en ligne seulement : décision du 2026-11-06) ; CLAUDE.md §4 règle 1 (rien ne
// s'efface) ; maquette journal-gardien.html (.crayon-btn).

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT = uuid(10);
const NORD = uuid(3);
const BANDE = uuid(4);
const OUSMANE = uuid(51);
const AWA = uuid(52);
const token = `e30.${btoa(JSON.stringify({ sub: OUSMANE, tenant: TENANT })).replace(/=+$/, '')}.c2ln`;
// Friday November 6th, 2026, 08:00 in Dakar.
const NOW = new Date('2026-11-06T08:00:00.000Z');
const AUJOURDHUI = '2026-11-06';
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

const uneBande = (fields: Partial<CaretakerCampaign> = {}): CaretakerCampaign => ({ campaignId: BANDE, placementDay: '2026-10-15', campaignDay: 22, liveCount: 938, journal: [], deliveries: [], ...fields });
const contexte = (bande: CaretakerCampaign = uneBande()): CaretakerContext => ({
  chef: null,
  sites: [{ siteId: NORD, name: 'Poulailler Nord', timeZone: 'Africa/Dakar', today: AUJOURDHUI, primaryCaretakerId: OUSMANE, campaigns: [bande] }],
});
const ligneDAwa = (fact: CaretakerJournalLine['fact'], fields: Partial<CaretakerJournalLine> = {}): CaretakerJournalLine => ({
  id: uuid(1), businessDate: AUJOURDHUI, recordedAt: '2026-11-06T07:00:00.000Z', author: { id: AWA, name: 'Awa' }, fact, corrected: false, retracted: false, ...fields,
});
const unMortDuTelephone = { siteId: NORD, campaignId: BANDE, businessDate: AUJOURDHUI, recordedAt: '2026-11-06T07:30:00.000Z', fact: { type: 'Death' as const, quantity: 1 } };

describe('Corriger une déclaration', () => {
  let outbox: Outbox;
  let heard: string[][];
  let http: HttpTestingController;

  const reseau = (online: boolean) => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });

  const ouvre = async (context: CaretakerContext = contexte()) => {
    const voice = provideHeardVoice([
      'correct-how-many', 'corrected', 'correct-needs-network', 'correct-too-old', 'correct-wait-sending', 'correct-refused', 'deaths-today-1', 'deaths-today-2', 'deaths-today-3', 'confirm', 'cancelled',
    ]);
    heard = voice.heard;
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: OUTBOX, useValue: Promise.resolve(outbox) }, { provide: CLOCK, useValue: { now: () => NOW } }, ...voice.providers],
    });
    http = TestBed.inject(HttpTestingController);
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
    return { element, tape, soon, refresh };
  };
  const feuille = (element: HTMLElement) => element.querySelector('app-line-correction app-sheet section.on');
  const ligne = (element: HTMLElement) => element.querySelector('.lines .line');
  const envoisAuJournal = () => http.match('/api/v1/journal/events');

  beforeEach(async () => {
    localStorage.clear();
    localStorage.setItem('yaar.session', JSON.stringify({ token, expiresAt: '2099-01-01T00:00:00.000Z', role: 'collaborator', account: { name: 'Ousmane', avatar: 'baobab', language: 'wo' } }));
    outbox = await Outbox.open(new IDBFactory());
    reseau(true);
  });

  afterEach(() => reseau(true));

  it('sans réseau, une déclaration jamais partie reste « en attente » : le téléphone n’essaie pas de l’envoyer', async () => {
    reseau(false);
    await outbox.record(OUSMANE, unMortDuTelephone);
    await ouvre();

    expect(envoisAuJournal()).toEqual([]);
    expect((await outbox.entriesOf(BANDE)).map((entry) => entry.state)).toEqual(['pending']);
  });

  it('une déclaration jamais partie se corrige librement, sans réseau : même ligne, même identifiant, nouvelle quantité — rien ne part, et les vivants suivent', async () => {
    reseau(false);
    const ecrit = await outbox.record(OUSMANE, unMortDuTelephone);
    const { element, tape, soon } = await ouvre();
    // The notebook reads the outbox after opening: on a loaded machine, that takes its time.
    await soon(() => expect(ligne(element)?.querySelector('.pencil')).not.toBeNull());

    await tape('.lines .line .pencil');
    expect(feuille(element)?.querySelector('.title')?.textContent).toContain('Corrige le nombre');
    expect(feuille(element)?.querySelector('.number')?.textContent).toBe('1');
    await soon(() => expect(heard.at(-1)).toEqual(['wo/correct-how-many']));
    await tape('app-line-correction app-sheet section.on .plus');
    await tape('app-line-correction app-sheet section.on .plus');
    await tape('app-line-correction app-sheet section.on .yes');
    await soon(() => expect(heard.at(-1)).toEqual(['wo/deaths-today-3', 'wo/confirm']));
    await tape('app-line-correction app-sheet section.on .yes');

    await soon(async () => expect((await outbox.entriesOf(BANDE)).map((entry) => [entry.id, entry.state, entry.payload])).toEqual([[ecrit.id, 'pending', { ...unMortDuTelephone, id: ecrit.id, fact: { type: 'Death', quantity: 3 } }]]));
    await soon(() => expect(ligne(element)?.querySelector('.words b')?.textContent).toBe('3 morts'));
    await soon(() => expect(element.querySelector('app-line-correction app-stamp .stamp')?.textContent).toContain('Corrigé'));
    await soon(() => expect(heard.at(-1)).toEqual(['wo/corrected']));
    expect(element.querySelector('.strip .alive')?.textContent).toContain('935');
    expect(envoisAuJournal()).toEqual([]);
  });

  it('pendant un envoi en doute, la ligne est verrouillée : le crayon n’ouvre rien, il dit d’attendre', async () => {
    await outbox.record(OUSMANE, unMortDuTelephone);
    const { element, tape, soon } = await ouvre();
    await soon(async () => expect((await outbox.entriesOf(BANDE)).map((entry) => entry.state)).toEqual(['in-doubt']));
    // The notebook learns it as soon as the sending leaves, without waiting for the answer.
    await soon(() => expect(ligne(element)?.querySelector('.pencil.locked')).not.toBeNull());

    await tape('.lines .line .pencil');

    expect(feuille(element)).toBeNull();
    expect(element.querySelector('app-line-correction .notice')?.textContent).toContain('Cette ligne part en ce moment');
    await soon(() => expect(heard.at(-1)).toEqual(['wo/correct-wait-sending']));
  });

  it('une ligne libre se verrouille dès que son envoi part, sans attendre la réponse du serveur', async () => {
    reseau(false);
    await outbox.record(OUSMANE, unMortDuTelephone);
    const { element, soon } = await ouvre();
    await soon(() => expect(ligne(element)?.querySelector('.pencil')?.className).toBe('pencil'));

    reseau(true);
    window.dispatchEvent(new Event('online'));

    await soon(() => expect(ligne(element)?.querySelector('.pencil.locked')).not.toBeNull());
  });

  it('une ligne déjà envoyée se corrige en ligne : une contre-déclaration part tout de suite au serveur, sans passer par l’outbox', async () => {
    const { element, tape, soon } = await ouvre(contexte(uneBande({ journal: [ligneDAwa({ type: 'Death', quantity: 3 })] })));

    await tape('.lines .line .pencil');
    expect(feuille(element)?.querySelector('.number')?.textContent).toBe('3');
    await tape('app-line-correction app-sheet section.on .minus');
    await tape('app-line-correction app-sheet section.on .yes');
    expect(feuille(element)?.querySelector('.already')).toBeNull();
    await tape('app-line-correction app-sheet section.on .yes');

    const envoi = http.expectOne('/api/v1/journal/events');
    expect((envoi.request.body as JournalBatchRequest).events).toEqual([
      { id: expect.any(String), siteId: NORD, campaignId: BANDE, businessDate: AUJOURDHUI, recordedAt: '2026-11-06T08:00:00.000Z', corrects: uuid(1), fact: { type: 'Death', quantity: 2 } },
    ]);
    expect(await outbox.entriesOf(BANDE)).toEqual([]);
    const sent = (envoi.request.body as JournalBatchRequest).events[0];
    envoi.flush({ outcomes: [{ index: 0, id: sent?.id, status: 'Accepted' }] });
    await soon(() => expect(element.querySelector('app-line-correction app-stamp .stamp')?.textContent).toContain('Corrigé'));
    await soon(() => expect(heard.at(-1)).toEqual(['wo/corrected']));
    http.expectOne('/api/v1/caretaker/context').flush(contexte(uneBande({ journal: [ligneDAwa({ type: 'Death', quantity: 2 }, { corrected: true })] })));
    await soon(() => expect(ligne(element)?.querySelector('.words')?.textContent).toContain('2 morts'));
    expect(ligne(element)?.querySelector('.words small')?.textContent).toContain('corrigé');
  });

  it('sans réseau, le crayon d’une ligne déjà envoyée est indisponible : il le montre, et le dit quand on le touche', async () => {
    reseau(false);
    const { element, tape, soon } = await ouvre(contexte(uneBande({ journal: [ligneDAwa({ type: 'Death', quantity: 3 })] })));

    expect(ligne(element)?.querySelector('.pencil.unavailable')).not.toBeNull();
    await tape('.lines .line .pencil');

    expect(feuille(element)).toBeNull();
    expect(element.querySelector('app-line-correction .notice')?.textContent).toContain('Pour corriger, il faut du réseau');
    await soon(() => expect(heard.at(-1)).toEqual(['wo/correct-needs-network']));
    expect(envoisAuJournal()).toEqual([]);
  });

  const corrigeEtRepond = async (reponse: (envoi: ReturnType<HttpTestingController['expectOne']>) => void) => {
    const ouvert = await ouvre(contexte(uneBande({ journal: [ligneDAwa({ type: 'Death', quantity: 3 })] })));
    await ouvert.tape('.lines .line .pencil');
    await ouvert.tape('app-line-correction app-sheet section.on .yes');
    await ouvert.tape('app-line-correction app-sheet section.on .yes');
    reponse(http.expectOne('/api/v1/journal/events'));
    return ouvert;
  };

  it('le serveur refuse un jour trop ancien : le post-it et la voix le disent, rien n’est montré comme corrigé', async () => {
    const { element, soon } = await corrigeEtRepond((envoi) => envoi.flush({ outcomes: [{ index: 0, status: 'Refused', refusal: { kind: 'CatchUpWindowPassed' } }] }));

    await soon(() => expect(element.querySelector('app-line-correction .notice')?.textContent).toContain('Ce jour est trop ancien pour corriger'));
    await soon(() => expect(heard.at(-1)).toEqual(['wo/correct-too-old']));
    expect(element.querySelector('app-line-correction app-stamp .stamp')).toBeNull();
  });

  it('un autre refus du serveur : « Le chef n’a pas pu accepter cette correction »', async () => {
    const { element, soon } = await corrigeEtRepond((envoi) => envoi.flush({ outcomes: [{ index: 0, status: 'Refused', refusal: { kind: 'CampaignClosed' } }] }));

    await soon(() => expect(element.querySelector('app-line-correction .notice')?.textContent).toContain('Le chef n’a pas pu accepter cette correction'));
    await soon(() => expect(heard.at(-1)).toEqual(['wo/correct-refused']));
  });

  it('après un refus, le cahier est relu : une ligne annulée entre-temps par le chef apparaît barrée, sans crayon', async () => {
    const { element, soon } = await corrigeEtRepond((envoi) => envoi.flush({ outcomes: [{ index: 0, status: 'Refused', refusal: { kind: 'DeclarationRetracted' } }] }));

    // The notebook reads the context again once the answer is in: wait for that request.
    const relu = await vi.waitFor(() => http.expectOne('/api/v1/caretaker/context'));
    relu.flush(contexte(uneBande({ journal: [ligneDAwa({ type: 'Death', quantity: 3 }, { retracted: true })] })));
    await soon(() => expect(ligne(element)?.querySelector('.words small')?.textContent).toContain('annulé par le chef'));
    expect(ligne(element)?.querySelector('.pencil')).toBeNull();
    await soon(() => expect(heard.at(-1)).toEqual(['wo/correct-refused']));
  });

  it('le serveur ne répond pas : la correction n’est pas gardée pour plus tard, la voix dit qu’il faut du réseau', async () => {
    const { element, soon } = await corrigeEtRepond((envoi) => envoi.error(new ProgressEvent('error')));

    await soon(() => expect(heard.at(-1)).toEqual(['wo/correct-needs-network']));
    expect(element.querySelector('app-line-correction app-stamp .stamp')).toBeNull();
    expect(await outbox.entriesOf(BANDE)).toEqual([]);
  });

  it('pas de crayon sur une ligne annulée ni sur « rien perdu », et le compteur ne descend jamais sous 1 : aucun geste n’efface', async () => {
    const annulee = ligneDAwa({ type: 'Death', quantity: 2 }, { retracted: true });
    const zero = ligneDAwa({ type: 'NoLoss' }, { id: uuid(2), recordedAt: '2026-11-06T06:00:00.000Z' });
    const unSac = ligneDAwa({ type: 'BagOpened', quantity: 1 }, { id: uuid(3), recordedAt: '2026-11-06T07:30:00.000Z' });
    const { element, tape } = await ouvre(contexte(uneBande({ journal: [annulee, zero, unSac] })));

    expect(element.querySelectorAll('.lines .line .pencil')).toHaveLength(1);
    await tape('.lines .line .pencil');
    expect(feuille(element)?.querySelector<HTMLButtonElement>('.minus')?.disabled).toBe(true);
  });
});
