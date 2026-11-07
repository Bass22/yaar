import { IDBFactory } from 'fake-indexeddb';
import type { JournalEventOutcome, JournalEventPayload } from '@contracts';
import { Outbox, type EventDraft } from '../outbox/outbox';
import type { SessionState } from '../session/session-store';
import { synchronize, type SyncAnswer } from './synchronize';

// Spec: backlog G.4 — la synchro envoie sans perdre ni doubler ; G.5 — refus du serveur et
// session expirée ; Architecture §5 « Synchronisation » ; CLAUDE.md §4 règle 3.

const OUSMANE = '00000000-0000-4000-8000-000000000051';
const AWA = '00000000-0000-4000-8000-000000000052';
const NOW = Date.parse('2026-11-07T08:00:00.000Z');
const active = (userId = OUSMANE): SessionState => ({ status: 'active', userId, role: 'collaborator', token: `jeton-${userId}`, expiresAt: '2026-11-14T08:00:00.000Z' });
const expired = (): SessionState => ({ status: 'expired', userId: OUSMANE, role: 'collaborator', token: `jeton-${OUSMANE}`, expiresAt: '2026-11-07T07:00:00.000Z' });

const morts = (quantity: number): EventDraft => ({
  siteId: '00000000-0000-4000-8000-000000000003',
  campaignId: '00000000-0000-4000-8000-000000000004',
  businessDate: '2026-11-05',
  recordedAt: '2026-11-05T18:30:00.000Z',
  fact: { type: 'Death', quantity },
});

// A server that accepts everything, unless told otherwise per identifier, and keeps what it received.
class FakeServer {
  readonly batches: JournalEventPayload[][] = [];
  readonly tokens: string[] = [];
  answer: 'outcomes' | 'unreachable' | 'unauthorized' = 'outcomes';
  readonly verdicts = new Map<string, JournalEventOutcome['status'] | { refusal: string }>();

  readonly transport = async (events: readonly JournalEventPayload[], token: string): Promise<SyncAnswer> => {
    this.tokens.push(token);
    if (this.answer !== 'outcomes') {
      return { kind: this.answer };
    }
    this.batches.push([...events]);
    return {
      kind: 'outcomes',
      outcomes: events.map((event, index): JournalEventOutcome => {
        const verdict = this.verdicts.get(event.id) ?? 'Accepted';
        return typeof verdict === 'object' ? { index, id: event.id, status: 'Refused', refusal: { kind: verdict.refusal } } : { index, id: event.id, status: verdict as 'Accepted' | 'Duplicate' };
      }),
    };
  };
}

describe('La synchro envoie sans perdre ni doubler', () => {
  let outbox: Outbox;
  let server: FakeServer;
  const sync = (session: SessionState = active()) => synchronize(outbox, session, server.transport, NOW);

  beforeEach(async () => {
    outbox = await Outbox.open(new IDBFactory());
    server = new FakeServer();
  });

  it("les événements en attente partent dans l'ordre de leur création, avec le jeton de la session, puis sont envoyés", async () => {
    const ids = [];
    for (const quantity of [1, 2, 3]) {
      ids.push((await outbox.record(OUSMANE, morts(quantity))).id);
    }

    const report = await sync();

    expect(server.batches.map((batch) => batch.map((event) => event.id))).toEqual([ids]);
    expect(server.tokens).toEqual([`jeton-${OUSMANE}`]);
    expect(report).toEqual({ sent: 3, refused: 0, stopped: null });
    expect(await outbox.waiting(OUSMANE)).toBe(0);
  });

  it("une coupure pendant l'envoi laisse les événements en doute ; ils repartent ensuite à l'identique, et sont comptés une fois", async () => {
    const entry = await outbox.record(OUSMANE, morts(3));
    server.answer = 'unreachable';

    expect(await sync()).toEqual({ sent: 0, refused: 0, stopped: 'Offline' });
    expect((await outbox.toSend(OUSMANE)).map((left) => left.state)).toEqual(['in-doubt']);
    expect(await outbox.replace(entry.id, morts(30))).toBe(false);

    server.answer = 'outcomes';
    expect(await sync()).toEqual({ sent: 1, refused: 0, stopped: null });
    expect(server.batches).toEqual([[entry.payload]]);
  });

  it("un événement signalé comme doublon par le serveur passe à « envoyé »", async () => {
    const entry = await outbox.record(OUSMANE, morts(3));
    server.verdicts.set(entry.id, 'Duplicate');

    expect(await sync()).toMatchObject({ sent: 1 });
    expect(await outbox.waiting(OUSMANE)).toBe(0);
  });

  it("un événement refusé est gardé comme refusé, avec son motif, et n'est jamais renvoyé", async () => {
    const refused = await outbox.record(OUSMANE, morts(3));
    const accepted = await outbox.record(OUSMANE, morts(1));
    server.verdicts.set(refused.id, { refusal: 'CatchUpWindowPassed' });

    expect(await sync()).toEqual({ sent: 1, refused: 1, stopped: null });
    await sync();
    await sync();

    expect(server.batches).toEqual([[refused.payload, accepted.payload]]);
    expect(await outbox.refused(OUSMANE)).toEqual([expect.objectContaining({ id: refused.id, refusal: { kind: 'CatchUpWindowPassed' } })]);
  });

  it("un long rattrapage part en lots de 100 au plus, dans l'ordre", async () => {
    for (let quantity = 1; quantity <= 150; quantity += 1) {
      await outbox.record(OUSMANE, morts(quantity));
    }

    expect(await sync()).toMatchObject({ sent: 150 });
    expect(server.batches.map((batch) => batch.length)).toEqual([100, 50]);
    expect(server.batches.flat().map((event) => (event as { fact: { quantity: number } }).fact.quantity)).toEqual(Array.from({ length: 150 }, (_, index) => index + 1));
  });

  it("une session expirée garde l'outbox sans rien envoyer ; la synchro reprend après la reconnexion", async () => {
    await outbox.record(OUSMANE, morts(3));

    expect(await sync(expired())).toEqual({ sent: 0, refused: 0, stopped: 'SessionExpired' });
    expect(server.tokens).toEqual([]);
    expect(await outbox.waiting(OUSMANE)).toBe(1);

    expect(await sync(active())).toMatchObject({ sent: 1, stopped: null });
  });

  it("une session refusée par le serveur avant son échéance — compte bloqué ou déconnecté partout — arrête la synchro et le dit ; rien n'est perdu", async () => {
    await outbox.record(OUSMANE, morts(3));
    server.answer = 'unauthorized';

    expect(await sync()).toEqual({ sent: 0, refused: 0, stopped: 'SessionRevoked' });
    expect(await outbox.waiting(OUSMANE)).toBe(1);
  });

  it("un jeton refusé après son échéance est une session expirée, pas révoquée", async () => {
    await outbox.record(OUSMANE, morts(3));
    server.answer = 'unauthorized';

    expect(await synchronize(outbox, active(), server.transport, Date.parse('2026-11-14T08:00:01.000Z'))).toMatchObject({ stopped: 'SessionExpired' });
  });

  it("sans personne de connecté rien ne part ; un autre compte n'envoie jamais ce qu'Ousmane a écrit (décision du 2026-11-07)", async () => {
    const byOusmane = await outbox.record(OUSMANE, morts(3));

    expect(await sync({ status: 'none' })).toEqual({ sent: 0, refused: 0, stopped: 'NoSession' });
    expect(await sync(active(AWA))).toEqual({ sent: 0, refused: 0, stopped: null });
    expect(server.batches).toEqual([]);
    expect((await outbox.toSend(OUSMANE)).map((entry) => entry.id)).toEqual([byOusmane.id]);
  });
});
