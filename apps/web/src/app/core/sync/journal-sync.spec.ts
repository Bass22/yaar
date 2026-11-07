import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { IDBFactory } from 'fake-indexeddb';
import { Outbox, type EventDraft } from '../outbox/outbox';
import { JournalSync, OUTBOX } from './journal-sync';

// Spec: backlog G.4 — les événements partent à l'ouverture et au retour du réseau, la pastille
// reflète le nombre en attente ; G.5 — une session révoquée arrête la synchro et le dit.

const OUSMANE = '00000000-0000-4000-8000-000000000051';
const tokenFor = (sub: string) => `e30.${btoa(JSON.stringify({ sub })).replace(/=+$/, '')}.c2ln`;
const morts = (quantity: number): EventDraft => ({
  siteId: '00000000-0000-4000-8000-000000000003',
  campaignId: '00000000-0000-4000-8000-000000000004',
  businessDate: '2026-11-05',
  recordedAt: '2026-11-05T18:30:00.000Z',
  fact: { type: 'Death', quantity },
});
// Lets the promises in flight settle, in the outbox and the HTTP client.
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('La synchro du téléphone', () => {
  let outbox: Outbox;
  let http: HttpTestingController;

  const start = () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), { provide: OUTBOX, useValue: Promise.resolve(outbox) }] });
    http = TestBed.inject(HttpTestingController);
    return TestBed.inject(JournalSync);
  };
  const answerAll = async () => {
    await settle();
    for (const request of http.match('/api/v1/journal/events')) {
      const events = (request.request.body as { events: { id: string }[] }).events;
      request.flush({ outcomes: events.map((event, index) => ({ index, id: event.id, status: 'Accepted' })) });
    }
    await settle();
  };

  beforeEach(async () => {
    localStorage.clear();
    localStorage.setItem('yaar.session', JSON.stringify({ token: tokenFor(OUSMANE), expiresAt: '2099-01-01T00:00:00.000Z', role: 'collaborator' }));
    outbox = await Outbox.open(new IDBFactory());
  });

  it("à l'ouverture de l'application, ce qui attendait part, avec le jeton de la session ; la pastille retombe à zéro", async () => {
    await outbox.record(OUSMANE, morts(3));
    const sync = start();
    await settle();

    const [request] = http.match('/api/v1/journal/events');
    expect(request?.request.headers.get('Authorization')).toBe(`Bearer ${tokenFor(OUSMANE)}`);
    await answerAll();
    expect(sync.waiting()).toBe(0);
  });

  it("une déclaration est gardée sur le téléphone avant de partir : sans réseau, la pastille compte 1 ; au retour du réseau, elle part", async () => {
    const sync = start();
    await answerAll();

    await sync.record(morts(3));
    await settle();
    http.match('/api/v1/journal/events').forEach((request) => request.error(new ProgressEvent('error')));
    await settle();
    expect(sync.waiting()).toBe(1);
    expect(sync.stopped()).toBe('Offline');

    globalThis.dispatchEvent(new Event('online'));
    await answerAll();
    expect(sync.waiting()).toBe(0);
    expect(sync.stopped()).toBeNull();
  });

  it("un seul envoi à la fois : une synchro demandée pendant un envoi attend la fin de celui-ci", async () => {
    await outbox.record(OUSMANE, morts(3));
    const sync = start();
    void sync.sync();
    void sync.sync();

    // Waits for the sending to leave, however slow the machine: exactly one request, never two.
    await vi.waitFor(() => http.expectOne('/api/v1/journal/events'));
    await settle();
    expect(http.match('/api/v1/journal/events')).toHaveLength(0);
  });

  it("un téléphone qui ne peut pas garder l'outbox le signale, au lieu d'échouer en silence", async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), { provide: OUTBOX, useValue: Outbox.open({ open: () => { throw new Error('disabled'); } } as unknown as IDBFactory) }] });
    const sync = TestBed.inject(JournalSync);
    await settle();

    expect(sync.storageUnavailable()).toBe(true);
  });

  it("une session révoquée par le serveur arrête la synchro et le dit ; rien n'est perdu", async () => {
    await outbox.record(OUSMANE, morts(3));
    const sync = start();
    await settle();

    http.expectOne('/api/v1/journal/events').flush({ statusCode: 401 }, { status: 401, statusText: 'Unauthorized' });
    await settle();

    expect(sync.stopped()).toBe('SessionRevoked');
    expect(sync.waiting()).toBe(1);
  });
});
