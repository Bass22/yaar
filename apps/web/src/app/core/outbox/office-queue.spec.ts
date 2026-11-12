import { IDBFactory } from 'fake-indexeddb';
import type { SessionState } from '../session/session-store';
import { OfficeQueue, synchronizeOffice, type OfficeAnswer } from './office-queue';

// Spec: backlog P.7 — les écritures de l'admin attendent le réseau ; architecture §5 « La file du
// bureau » (2026-11-12) ; CLAUDE.md §4 règles 2 (identifiant de l'appareil, idempotence) et 3 (rien
// ne se perd).

const GERANT = '00000000-0000-4000-8000-000000000054';
const AUTRE = '00000000-0000-4000-8000-000000000055';
const ACCOUNT = { name: 'Bassirou', avatar: null, language: 'fr' } as const;
const active = (userId = GERANT): SessionState => ({ status: 'active', userId, role: 'admin', token: `jeton-${userId}`, expiresAt: '2099-01-01T00:00:00.000Z', account: ACCOUNT });
const eau = (id: string) => ({ id, campaignId: 'b', costTypeId: 't', spentOn: '2026-11-12', amount: 12_500, note: null, payment: { kind: 'Paid' }, receipt: null, recordedAt: '2026-11-12T08:00:00.000Z' });

// A server that answers each request as told, accepting by default, and keeps what it received.
class FakeServer {
  readonly received: { url: string; id: string; token: string }[] = [];
  readonly answers = new Map<string, OfficeAnswer>();
  offline = false;

  readonly transport = async (url: string, body: { id: string }, token: string): Promise<OfficeAnswer> => {
    if (this.offline) return { kind: 'unreachable' };
    this.received.push({ url, id: body.id, token });
    return this.answers.get(body.id) ?? { kind: 'sent' };
  };
}

describe('Les écritures du bureau attendent le réseau', () => {
  let factory: IDBFactory;
  let queue: OfficeQueue;
  let server: FakeServer;

  beforeEach(async () => {
    factory = new IDBFactory();
    queue = await OfficeQueue.open(factory);
    server = new FakeServer();
  });

  it('une dépense saisie sans réseau est gardée sur l’appareil avant tout appel, avec son identifiant, et survit à la fermeture', async () => {
    await queue.keep(GERANT, 'cost', '/api/v1/costs', eau('c-1'), 'b');
    queue.close();

    const reopened = await OfficeQueue.open(factory);

    expect((await reopened.entries(GERANT)).map(({ id, kind, url, state, subject }) => ({ id, kind, url, state, subject }))).toEqual([{ id: 'c-1', kind: 'cost', url: '/api/v1/costs', state: 'pending', subject: 'b' }]);
  });

  it('au retour du réseau, les écritures partent dans l’ordre où elles ont été écrites, sous le compte de leur auteur', async () => {
    await queue.keep(GERANT, 'cost', '/api/v1/costs', eau('c-1'), 'b');
    await queue.keep(GERANT, 'payment', '/api/v1/orders/o/payments', { id: 'p-1' }, 'o');
    await queue.keep(GERANT, 'settlement', '/api/v1/settlements', { id: 's-1' }, 't');

    expect(await synchronizeOffice(queue, active(), server.transport)).toEqual({ sent: 3, refused: 0, stopped: null });
    expect(server.received).toEqual([
      { url: '/api/v1/costs', id: 'c-1', token: `jeton-${GERANT}` },
      { url: '/api/v1/orders/o/payments', id: 'p-1', token: `jeton-${GERANT}` },
      { url: '/api/v1/settlements', id: 's-1', token: `jeton-${GERANT}` },
    ]);
    expect(await queue.entries(GERANT)).toEqual([]);
  });

  it('sans réponse, rien ne se perd : l’écriture reste en attente et repart, identique ; envoyée, elle ne repart plus', async () => {
    await queue.keep(GERANT, 'cost', '/api/v1/costs', eau('c-1'), 'b');
    server.offline = true;

    expect(await synchronizeOffice(queue, active(), server.transport)).toEqual({ sent: 0, refused: 0, stopped: 'Offline' });
    expect((await queue.entries(GERANT)).map(({ state }) => state)).toEqual(['pending']);

    server.offline = false;
    await synchronizeOffice(queue, active(), server.transport);
    await synchronizeOffice(queue, active(), server.transport);
    expect(server.received.map(({ id }) => id)).toEqual(['c-1']);
  });

  it('refusée par le serveur, elle reste visible avec son motif, jamais renvoyée ; la suivante part quand même', async () => {
    await queue.keep(GERANT, 'cost', '/api/v1/costs', eau('c-1'), 'b');
    await queue.keep(GERANT, 'cost', '/api/v1/costs', eau('c-2'), 'b');
    server.answers.set('c-1', { kind: 'refused', refusal: 'CampaignClosed' });

    expect(await synchronizeOffice(queue, active(), server.transport)).toEqual({ sent: 1, refused: 1, stopped: null });
    await synchronizeOffice(queue, active(), server.transport);

    expect(server.received.map(({ id }) => id)).toEqual(['c-1', 'c-2']);
    expect((await queue.entries(GERANT)).map(({ id, state, refusal }) => ({ id, state, refusal }))).toEqual([{ id: 'c-1', state: 'refused', refusal: 'CampaignClosed' }]);
  });

  it('un refus vu peut être retiré de la liste ; une écriture en attente, jamais', async () => {
    await queue.keep(GERANT, 'cost', '/api/v1/costs', eau('c-1'), 'b');
    await queue.keep(GERANT, 'cost', '/api/v1/costs', eau('c-2'), 'b');
    server.answers.set('c-1', { kind: 'refused', refusal: 'CampaignClosed' });
    server.answers.set('c-2', { kind: 'unreachable' });
    await synchronizeOffice(queue, active(), server.transport);

    await queue.dismiss('c-1');
    await queue.dismiss('c-2');

    expect((await queue.entries(GERANT)).map(({ id }) => id)).toEqual(['c-2']);
  });

  it('une écriture ne part que sous le compte de son auteur ; sans session ou session refusée, rien ne part et rien ne se perd', async () => {
    await queue.keep(AUTRE, 'cost', '/api/v1/costs', eau('c-9'), 'b');

    await synchronizeOffice(queue, active(GERANT), server.transport);
    expect(server.received).toEqual([]);
    expect(await synchronizeOffice(queue, { status: 'none' }, server.transport)).toEqual({ sent: 0, refused: 0, stopped: 'NoSession' });

    server.answers.set('c-9', { kind: 'unauthorized' });
    expect(await synchronizeOffice(queue, active(AUTRE), server.transport)).toEqual({ sent: 0, refused: 0, stopped: 'SessionExpired' });
    expect((await queue.entries(AUTRE)).map(({ state }) => state)).toEqual(['pending']);
  });
});
