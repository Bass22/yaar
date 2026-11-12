import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { IDBFactory } from 'fake-indexeddb';
import type { CaretakerCampaign, CaretakerContext, JournalRefusal } from '@contracts';
import { provideHeardVoice } from '../../core/audio/testing';
import { CLOCK } from '../../core/clock';
import { Outbox, type EventDraft } from '../../core/outbox/outbox';
import { OUTBOX } from '../../core/sync/journal-sync';
import { NotebookPage } from '../notebook/notebook-page';

// Spec: backlog G.5 ; cahier des charges « Une déclaration refusée n'est jamais perdue »
// (décision du 2026-11-08), « La confiance est visible » ; CLAUDE.md §4 règle 3.

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT = uuid(10);
const NORD = uuid(3);
const BANDE = uuid(4);
const OUSMANE = uuid(51);
const token = `e30.${btoa(JSON.stringify({ sub: OUSMANE, tenant: TENANT })).replace(/=+$/, '')}.c2ln`;
// Friday November 6th, 2026, 08:00 in Dakar.
const NOW = new Date('2026-11-06T08:00:00.000Z');
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

const uneBande = (fields: Partial<CaretakerCampaign> = {}): CaretakerCampaign => ({ campaignId: BANDE, placementDay: '2026-10-15', campaignDay: 22, liveCount: 938, journal: [], deliveries: [], weighingRequests: [], strain: 'Cobb500', ...fields });
const contexte = (): CaretakerContext => ({
  chef: null,
  sites: [{ siteId: NORD, name: 'Poulailler Nord', timeZone: 'Africa/Dakar', today: '2026-11-06', primaryCaretakerId: OUSMANE, campaigns: [uneBande()] }],
});
const morts = (quantity: number, businessDate: string): EventDraft => ({ siteId: NORD, campaignId: BANDE, businessDate, recordedAt: '2026-11-06T07:00:00.000Z', fact: { type: 'Death', quantity } });
const sessionUntil = (expiresAt: string) =>
  localStorage.setItem('yaar.session', JSON.stringify({ token, expiresAt, role: 'collaborator', account: { name: 'Ousmane', avatar: 'baobab', language: 'wo' } }));

describe('Le gardien apprend ce que le serveur a refusé', () => {
  let outbox: Outbox;
  let heard: string[][];
  let http: HttpTestingController;

  const refusee = async (draft: EventDraft, refusal: JournalRefusal) => {
    const entry = await outbox.record(OUSMANE, draft);
    await outbox.markRefused(entry.id, refusal);
    return entry;
  };

  const ouvre = async () => {
    const voice = provideHeardVoice(['sync-refused', 'sync-refused-too-old', 'nothing-lost-refused', 'sync-stopped', 'sync-sign-in-again']);
    heard = voice.heard;
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: OUTBOX, useValue: Promise.resolve(outbox) }, { provide: CLOCK, useValue: { now: () => NOW } }, ...voice.providers],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(NotebookPage);
    fixture.detectChanges();
    http.match('/api/v1/caretaker/context').forEach((request) => request.flush(contexte()));
    const element = fixture.nativeElement as HTMLElement;
    const refresh = async () => {
      await settle();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    const soon = (check: () => void | Promise<void>) => vi.waitFor(async () => {
      await refresh();
      await check();
    });
    await refresh();
    return { element, refresh, soon };
  };
  const postIt = (element: HTMLElement) => element.querySelector('app-refusal-notice .refused');

  beforeEach(async () => {
    localStorage.clear();
    sessionUntil('2099-01-01T00:00:00.000Z');
    outbox = await Outbox.open(new IDBFactory());
  });

  it('des morts refusés parce que trop anciens : le post-it les montre — picto, quantité, jour — et la voix dit que le chef les a reçus', async () => {
    await refusee(morts(3, '2026-11-01'), { kind: 'CatchUpWindowPassed' });
    const { element, soon } = await ouvre();

    await soon(() => expect(postIt(element)).not.toBeNull());
    const item = postIt(element)?.querySelector('.item');
    expect(item?.querySelector('.what use')?.getAttribute('href')).toContain('#dead-chicken');
    expect(item?.textContent).toContain('3 morts');
    expect(item?.textContent).toContain('1 nov.');
    (item?.querySelector('app-speaker-button button') as HTMLElement | null)?.click();
    await soon(() => expect(heard.at(-1)).toEqual(['wo/sync-refused-too-old']));
  });

  it('un autre refus dit « Le chef n’a pas pu accepter une déclaration. Il l’a reçue, il s’en occupe » ; un « rien perdu » refusé dit pourquoi', async () => {
    await refusee(morts(2, '2026-11-05'), { kind: 'CampaignClosed' });
    await refusee({ siteId: NORD, campaignId: BANDE, businessDate: '2026-11-05', recordedAt: '2026-11-06T07:10:00.000Z', fact: { type: 'NoLoss' } }, { kind: 'NoLossAfterDeaths' });
    const { element, soon } = await ouvre();

    await soon(() => expect(postIt(element)?.querySelectorAll('.item')).toHaveLength(2));
    const [closed, zero] = Array.from(postIt(element)?.querySelectorAll<HTMLElement>('.item') ?? []);
    expect(zero?.textContent).toContain('Rien perdu');
    closed?.querySelector<HTMLElement>('app-speaker-button button')?.click();
    await soon(() => expect(heard.at(-1)).toEqual(['wo/sync-refused']));
    zero?.querySelector<HTMLElement>('app-speaker-button button')?.click();
    await soon(() => expect(heard.at(-1)).toEqual(['wo/nothing-lost-refused']));
  });

  it('« J’ai compris » range le post-it, et il ne revient pas à la prochaine ouverture', async () => {
    await refusee(morts(3, '2026-11-01'), { kind: 'CatchUpWindowPassed' });
    const first = await ouvre();
    await first.soon(() => expect(postIt(first.element)).not.toBeNull());

    postIt(first.element)?.querySelector<HTMLElement>('.understood')?.click();
    await first.soon(() => expect(postIt(first.element)).toBeNull());
    TestBed.resetTestingModule();

    const again = await ouvre();
    await again.refresh();
    expect(postIt(again.element)).toBeNull();
  });

  it('sans refus, aucun post-it', async () => {
    const { element, refresh } = await ouvre();
    await refresh();

    expect(postIt(element)).toBeNull();
    expect(element.querySelector('app-refusal-notice .session')).toBeNull();
  });

  it('un compte bloqué ou déconnecté partout : la synchro s’arrête, et le post-it dit « Ton compte ne peut plus envoyer. Parle au chef. Rien n’est perdu »', async () => {
    await outbox.record(OUSMANE, morts(1, '2026-11-06'));
    const { element, soon } = await ouvre();

    // The server answers 401 before the token's own deadline: the session was revoked.
    let sent: ReturnType<HttpTestingController['match']> = [];
    await soon(() => {
      sent = http.match('/api/v1/journal/events');
      expect(sent.length).toBeGreaterThan(0);
    });
    sent.forEach((request) => request.flush(null, { status: 401, statusText: 'Unauthorized' }));
    await soon(() => expect(element.querySelector('app-refusal-notice .session')?.textContent).toContain('Ton compte ne peut plus envoyer'));
    element.querySelector<HTMLElement>('app-refusal-notice .session app-speaker-button button')?.click();
    await soon(() => expect(heard.at(-1)).toEqual(['wo/sync-stopped']));
  });

  it('une session expirée : le post-it dit de se reconnecter, et mène à l’entrée du code', async () => {
    sessionUntil('2026-11-01T00:00:00.000Z');
    await outbox.record(OUSMANE, morts(1, '2026-11-06'));
    const { element, soon } = await ouvre();

    await soon(() => expect(element.querySelector('app-refusal-notice .session')?.textContent).toContain('Reconnecte-toi pour envoyer tes déclarations'));
    expect(element.querySelector('app-refusal-notice .session a')?.getAttribute('href')).toBe('/sign-in');
    element.querySelector<HTMLElement>('app-refusal-notice .session app-speaker-button button')?.click();
    await soon(() => expect(heard.at(-1)).toEqual(['wo/sync-sign-in-again']));
  });
});
