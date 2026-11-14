import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { IDBFactory } from 'fake-indexeddb';
import type { CaretakerCampaign, CaretakerContext, CaretakerSite } from '@contracts';
import { CLOCK } from '../../core/clock';
import { Outbox } from '../../core/outbox/outbox';
import { OUTBOX } from '../../core/sync/journal-sync';
import { provideHeardVoice } from '../../core/audio/testing';
import { Notebook } from './notebook';
import { notebookTitle } from './notebook-cover';
import { NotebookPage } from './notebook-page';

// Spec: backlog J.1 (couverture et bandeau du jour, choix de la bande), J.2 (trois jours et
// bannière du jour passé), J.3 (le journal du jour) ; cahier des charges « En-tête et contexte »,
// « Rattrapage », « Journal du jour » ; maquettes journal-gardien.html et
// journal-gardien-entree.html ; décisions du 2026-11-07 (une bande : pas de choix ; deux :
// « les petits » et « les grands » ; un seul site par gardien).

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT = uuid(10);
const NORD = uuid(3);
const GRANDS = uuid(4);
const PETITS = uuid(7);
const OUSMANE = uuid(51);
const AWA = uuid(52);
const token = (sub: string) => `e30.${btoa(JSON.stringify({ sub, tenant: TENANT })).replace(/=+$/, '')}.c2ln`;
// Friday November 6th, 2026, 08:00 in Dakar.
const NOW = new Date('2026-11-06T08:00:00.000Z');
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

const uneBande = (fields: Partial<CaretakerCampaign> = {}): CaretakerCampaign => ({ campaignId: GRANDS, placementDay: '2026-10-15', campaignDay: 22, liveCount: null, journal: [], deliveries: [], weighingRequests: [], strain: 'Cobb500', ...fields });
const unSite = (fields: Partial<CaretakerSite> = {}): CaretakerSite => ({ siteId: NORD, name: 'Poulailler Nord', timeZone: 'Africa/Dakar', today: '2026-11-06', primaryCaretakerId: OUSMANE, campaigns: [uneBande()], ...fields });
const contexte = (...sites: CaretakerSite[]): CaretakerContext => ({ sites, chef: null });

describe('Le cahier du gardien', () => {
  let http: HttpTestingController;
  let outbox: Outbox;
  let heard: string[][];

  const connecte = (userId = OUSMANE, name = 'Ousmane') =>
    localStorage.setItem('yaar.session', JSON.stringify({ token: token(userId), expiresAt: '2099-01-01T00:00:00.000Z', role: 'collaborator', account: { name, avatar: 'baobab', language: 'wo' } }));

  /** Opens the notebook; `answer` is what the server says to the context request, `null` for no network. */
  const ouvre = async (answer: CaretakerContext | null, asked: string | null = null) => {
    const voice = provideHeardVoice(['day-today', 'past-day-yesterday', 'past-day-before-yesterday', 'campaign-young', 'campaign-old', 'no-campaign', 'sign-in-offline']);
    heard = voice.heard;
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: OUTBOX, useValue: Promise.resolve(outbox) },
        { provide: CLOCK, useValue: { now: () => NOW } },
        ...voice.providers,
        // A tap on a notification opens the notebook on the flock it names (Y.4)
        ...(asked === null ? [] : [{ provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({ campaign: asked }) } } }]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(NotebookPage);
    fixture.detectChanges();
    const request = http.expectOne('/api/v1/caretaker/context');
    if (answer === null) {
      request.error(new ProgressEvent('error'));
    } else {
      request.flush(answer);
    }
    const element = fixture.nativeElement as HTMLElement;
    const refresh = async () => {
      await settle();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    const click = async (selector: string, text?: string) => {
      const target = Array.from(element.querySelectorAll<HTMLElement>(selector)).find((candidate) => text === undefined || candidate.textContent?.includes(text));
      target?.click();
      await refresh();
    };
    await refresh();
    const notebook = fixture.debugElement.injector.get(Notebook);
    /** Waits for what the outbox holds to reach the screen: its reads take their time on a loaded machine. */
    const soon = (check: () => void) => vi.waitFor(async () => {
      await refresh();
      check();
    });
    return { element, click, refresh, notebook, soon };
  };

  beforeEach(async () => {
    localStorage.clear();
    connecte();
    outbox = await Outbox.open(new IDBFactory());
  });

  describe('la couverture', () => {
    it("le cahier porte l'avatar et le nom de qui le tient, et le nom de son poulailler", async () => {
      const { element } = await ouvre(contexte(unSite()));

      expect(element.querySelector('.cover .name')?.textContent).toBe("Cahier d'Ousmane");
      expect(element.querySelector('.cover app-avatar-badge [role="img"]')?.getAttribute('aria-label')).toBe('Le baobab');
      expect(element.querySelector('.cover .site')?.textContent).toContain('Poulailler Nord');
    });

    it("le nom s'écrit comme sur un vrai cahier : « Cahier d'Awa », « Cahier de Modou »", () => {
      expect([notebookTitle('Awa'), notebookTitle('Modou'), notebookTitle('Éric')]).toEqual(["Cahier d'Awa", 'Cahier de Modou', "Cahier d'Éric"]);
    });

    it("le titulaire du site voit son badge ; un remplaçant ne l'a pas", async () => {
      expect((await ouvre(contexte(unSite()))).element.querySelector('.cover .primary')?.getAttribute('aria-label')).toBe('Tu es le titulaire du site');

      TestBed.resetTestingModule();
      connecte(AWA, 'Awa');
      expect((await ouvre(contexte(unSite()))).element.querySelector('.cover .primary')).toBeNull();
    });
  });

  describe('la bande', () => {
    it("avec une seule bande, le cahier s'ouvre directement dessus : aucun choix, le bandeau dit le jour J", async () => {
      const { element } = await ouvre(contexte(unSite()));

      expect(element.querySelector('app-campaign-choice')).toBeNull();
      expect(element.querySelector('.strip .day')?.textContent).toContain('Jour 22');
      expect(element.querySelector('.strip')?.getAttribute('aria-label')).toBe('jour 22 de la bande');
    });

    it("tant que les poussins reçus ne sont pas connus, le bandeau ne montre pas de vivants : ni zéro, ni nombre inventé ; connus, il les montre", async () => {
      expect((await ouvre(contexte(unSite()))).element.querySelector('.strip .alive')).toBeNull();

      TestBed.resetTestingModule();
      const { element } = await ouvre(contexte(unSite({ campaigns: [uneBande({ liveCount: 938 })] })));
      expect(element.querySelector('.strip .alive')?.textContent).toContain('938');
    });

    it("avec deux bandes, le cahier demande laquelle, en grandes cartes — les petits, puis les grands — et n'écrit sur aucune avant le choix", async () => {
      const { element, notebook } = await ouvre(contexte(unSite({ campaigns: [uneBande(), uneBande({ campaignId: PETITS, placementDay: '2026-11-01' })] })));

      expect(Array.from(element.querySelectorAll('.cards .card')).map((card) => [card.querySelector('.name')?.textContent, card.querySelector('.day')?.textContent])).toEqual([
        ['Les petits', 'Jour 5'],
        ['Les grands', 'Jour 22'],
      ]);
      expect(element.querySelector('app-day-strip')).toBeNull();
      expect(notebook.declarationTarget()).toBeNull();
    });

    // Spec: backlog Y.4 — un tap sur une notification ouvre le cahier sur la bande qu'elle nomme
    it('ouvert depuis une notification, le cahier est sur la bande qu’elle nomme, sans demander ; une bande qu’il n’a pas laisse le choix', async () => {
      const deux = () => contexte(unSite({ campaigns: [uneBande(), uneBande({ campaignId: PETITS, placementDay: '2026-11-01' })] }));
      const nommee = await ouvre(deux(), PETITS);
      expect(nommee.notebook.declarationTarget()?.campaignId).toBe(PETITS);
      expect(nommee.element.querySelector('.cards .card')).toBeNull();

      TestBed.resetTestingModule();
      const inconnue = await ouvre(deux(), '00000000-0000-4000-8000-000000000999');
      expect(inconnue.notebook.declarationTarget()).toBeNull();
    });

    it('la bande choisie devient un intercalaire actif, et le bandeau redit la bande ; un tap sur l’autre onglet change de bande', async () => {
      const { element, click, notebook } = await ouvre(contexte(unSite({ campaigns: [uneBande(), uneBande({ campaignId: PETITS, placementDay: '2026-11-01' })] })));
      await click('.cards .card', 'Les petits');

      expect(element.querySelector('.tab.active')?.getAttribute('aria-label')).toBe('Les petits, jour 5');
      expect(element.querySelector('app-day-strip .campaign')?.textContent).toContain('Les petits · J5');
      expect(notebook.declarationTarget()?.campaignId).toBe(PETITS);

      await click('.tab', 'J22');
      expect(heard).toEqual([['wo/campaign-young'], ['wo/campaign-old']]);
      expect(element.querySelector('app-day-strip .campaign')?.textContent).toContain('Les grands · J22');
      expect(notebook.declarationTarget()?.campaignId).toBe(GRANDS);
    });

    // Spec: backlog Q.11 (décision du fondateur du 2026-11-13) — la litière et l'aliment arrivent avant les poussins
    it("une bande à venir ne s'ouvre pas comme une bande en cours ; seule sa livraison annoncée se montre, et elle s'écrit pour aujourd'hui sur cette bande", async () => {
      const livraison = { orderId: uuid(20), lines: [{ orderLineId: uuid(21), name: 'Copeaux', category: 'Bedding' as const, feedStage: null, expected: 30, received: 0, remaining: 30 }] };
      const aVenir = uneBande({ campaignId: PETITS, placementDay: '2026-11-09', campaignDay: -3, deliveries: [livraison] });
      const { element, notebook } = await ouvre(contexte(unSite({ campaigns: [aVenir] })));

      // Pas de bande en cours : le cahier le dit, sans jours ni gestes
      expect(element.querySelector('.notice')?.textContent).toContain('Pas de bande en cours');
      expect(element.querySelector('.days')).toBeNull();
      expect(notebook.campaigns()).toEqual([]);
      // Mais la carte de livraison est là, pour la bande qui arrive, datée d'aujourd'hui
      expect(element.querySelectorAll('app-delivery-card')).toHaveLength(1);
      expect(notebook.upcomingDeliveries()).toEqual([{ campaignId: PETITS, lines: [expect.objectContaining({ orderLineId: uuid(21), remaining: 30 })], target: { siteId: NORD, campaignId: PETITS, businessDate: '2026-11-06' } }]);
    });

    it("une bande à venir sans livraison annoncée ne montre rien de plus", async () => {
      const { element, notebook } = await ouvre(contexte(unSite({ campaigns: [uneBande(), uneBande({ campaignId: PETITS, placementDay: '2026-11-09', campaignDay: -3 })] })));

      expect(notebook.campaigns().map(({ campaignId }) => campaignId)).toEqual([GRANDS]);
      expect(notebook.upcomingDeliveries()).toEqual([]);
      expect(element.querySelector('app-campaign-choice')).toBeNull();
    });

    it("sans bande en cours, le cahier le dit — picto, mots, et sa voix au haut-parleur —, sans afficher de jour ni de chiffre", async () => {
      const { element, click } = await ouvre(contexte(unSite({ campaigns: [] })));

      expect(element.querySelector('.notice')?.textContent).toContain('Pas de bande en cours');
      expect(element.querySelector('app-day-strip')).toBeNull();
      await click('.notice app-speaker-button button');
      expect(heard).toEqual([['wo/no-campaign']]);
    });
  });

  describe('hors-ligne', () => {
    it("sans réseau, le cahier s'ouvre avec le dernier contexte reçu, et le jour J avance avec l'horloge du téléphone", async () => {
      localStorage.setItem('yaar.context', JSON.stringify({ userId: OUSMANE, context: contexte(unSite({ today: '2026-11-03', campaigns: [uneBande({ campaignDay: 19 })] })) }));

      const { element } = await ouvre(null);

      expect(element.querySelector('.strip .day')?.textContent).toContain('Jour 22');
    });

    it("le contexte gardé ne s'ouvre qu'au compte qui l'a reçu : un autre compte connecté sur ce téléphone ne le voit pas", async () => {
      localStorage.setItem('yaar.context', JSON.stringify({ userId: AWA, context: contexte(unSite()) }));

      const { element } = await ouvre(null);

      expect(element.querySelector('.cover .site')).toBeNull();
      expect(element.querySelector('.notice')?.textContent).toContain('Pas de réseau');
    });

    it('le contexte reçu est gardé pour la prochaine ouverture', async () => {
      await ouvre(contexte(unSite()));

      expect(JSON.parse(localStorage.getItem('yaar.context') ?? 'null')).toEqual({ userId: OUSMANE, context: contexte(unSite()) });
    });
  });

  describe('les trois jours', () => {
    const bandeDeTroisJours = () =>
      uneBande({
        journal: [
          { id: uuid(1), businessDate: '2026-11-04', recordedAt: '2026-11-04T18:00:00.000Z', author: { id: AWA, name: 'Awa' }, fact: { type: 'NoLoss' }, corrected: false, retracted: false },
          { id: uuid(2), businessDate: '2026-11-06', recordedAt: '2026-11-06T07:00:00.000Z', author: { id: AWA, name: 'Awa' }, fact: { type: 'Death', quantity: 3 }, corrected: false, retracted: false },
        ],
      });

    it("avant-hier, hier et aujourd'hui, aujourd'hui choisi ; un jour à zéro déclaré, un jour oublié et un jour avec des morts ne se ressemblent pas", async () => {
      const { element } = await ouvre(contexte(unSite({ campaigns: [bandeDeTroisJours()] })));

      expect(Array.from(element.querySelectorAll('.days .day')).map((tab) => tab.getAttribute('aria-label'))).toEqual([
        'Avant-hier, 4 nov. : rien perdu',
        'Hier, 5 nov. : morts pas encore écrits',
        "Aujourd'hui, 6 nov. : 3 morts",
      ]);
      expect(element.querySelector('.days .day.active')?.textContent).toContain("Aujourd'hui");
      expect(element.querySelector('.days .day:nth-child(1) .zero')).not.toBeNull();
      expect(element.querySelector('.days .day:nth-child(2) .missing')).not.toBeNull();
      expect(element.querySelector('.days .day:nth-child(3) .deaths')?.textContent).toContain('3');
    });

    // Spec: backlog J.4 (demande du fondateur du 2026-11-13)
    it("le jour de la mise en place (J0), le cahier ne montre qu'aujourd'hui ; le lendemain (J1), hier et aujourd'hui", async () => {
      const j0 = await ouvre(contexte(unSite({ campaigns: [uneBande({ placementDay: '2026-11-06', campaignDay: 0 })] })));
      expect(Array.from(j0.element.querySelectorAll('.days .day')).map((tab) => tab.querySelector('.name')?.textContent)).toEqual(["Aujourd'hui"]);

      TestBed.resetTestingModule();
      const j1 = await ouvre(contexte(unSite({ campaigns: [uneBande({ placementDay: '2026-11-05', campaignDay: 1 })] })));
      expect(Array.from(j1.element.querySelectorAll('.days .day')).map((tab) => tab.querySelector('.name')?.textContent)).toEqual(['Hier', "Aujourd'hui"]);
    });

    it("choisir hier ouvre la bannière violette « Tu écris pour : HIER », et ce qui s'écrit alors porte la date d'hier ; « Aujourd'hui » la referme", async () => {
      const { element, click, notebook } = await ouvre(contexte(unSite({ campaigns: [bandeDeTroisJours()] })));
      expect(element.querySelector('.past')).toBeNull();

      await click('.days .day', 'Hier');
      expect(element.querySelector('.past')?.textContent).toContain('Tu écris pour : HIER');
      expect(notebook.declarationTarget()).toEqual({ siteId: NORD, campaignId: GRANDS, businessDate: '2026-11-05' });

      await click('.past button');
      expect(element.querySelector('.past')).toBeNull();
      expect(notebook.declarationTarget()?.businessDate).toBe('2026-11-06');
      // Spec: backlog J.2 — la bannière se dit à voix haute, dans la langue du gardien
      expect(heard).toEqual([['wo/past-day-yesterday'], ['wo/day-today']]);
    });
  });

  describe('le journal du jour', () => {
    it("chaque ligne montre son picto, sa quantité et son auteur ; ce qui attend sur le téléphone porte l'horloge, ce que le serveur a porte le tampon", async () => {
      await outbox.record(OUSMANE, { siteId: NORD, campaignId: GRANDS, businessDate: '2026-11-06', recordedAt: '2026-11-06T07:30:00.000Z', fact: { type: 'BagOpened', quantity: 2 } });
      const bande = uneBande({ journal: [{ id: uuid(2), businessDate: '2026-11-06', recordedAt: '2026-11-06T07:00:00.000Z', author: { id: AWA, name: 'Awa' }, fact: { type: 'Death', quantity: 3 }, corrected: false, retracted: false }] });

      const { element, soon } = await ouvre(contexte(unSite({ campaigns: [bande] })));
      await soon(() => expect(element.querySelectorAll('.lines .line')).toHaveLength(2));

      const lignes = Array.from(element.querySelectorAll('.lines .line'));
      expect(lignes.map((ligne) => [ligne.querySelector('.words b')?.textContent, ligne.querySelector('.words small')?.textContent])).toEqual([
        ['2 sacs ouverts', "Ousmane · en attente d'envoi"],
        ['3 morts', 'Awa · bien envoyé'],
      ]);
      expect(lignes.map((ligne) => ligne.querySelector('.state [role="img"]')?.getAttribute('aria-label'))).toEqual(["En attente d'envoi", 'Bien envoyé']);
      expect(lignes[0]?.querySelector('.what use')?.getAttribute('href')).toBe('pictograms.svg#open-bag');
    });

    it("le journal d'un jour vide le dit par un picto et des mots, pas par un vide", async () => {
      const { element } = await ouvre(contexte(unSite()));

      expect(element.querySelector('app-day-journal .empty app-pictogram')).not.toBeNull();
      expect(element.querySelector('app-day-journal .empty')?.textContent).toContain("Rien d'écrit pour l'instant");
    });
  });
});
