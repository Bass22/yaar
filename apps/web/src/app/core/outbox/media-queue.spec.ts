import { IDBFactory } from 'fake-indexeddb';
import type { SessionState } from '../session/session-store';
import { MediaQueue, MediaQueueFull, synchronizeMedia, type MediaAnswer } from './media-queue';

// Spec: backlog M.2 — les médias attendent le réseau ; architecture §5 « La file des médias »
// (décision du 2026-11-11) ; CLAUDE.md §4 règles 3 (rien ne se perd) et 13 (une image ne s'efface
// pas avant d'être arrivée).

const OUSMANE = '00000000-0000-4000-8000-000000000051';
const AWA = '00000000-0000-4000-8000-000000000052';
const ACCOUNT = { name: 'Ousmane', avatar: null, language: 'fr' } as const;
const active = (userId = OUSMANE): SessionState => ({ status: 'active', userId, role: 'collaborator', token: `jeton-${userId}`, expiresAt: '2026-11-14T08:00:00.000Z', account: ACCOUNT });

const photo = (words: string) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode(words), 0xff, 0xd9]);
const sha256 = async (bytes: Uint8Array) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

// A server that answers each media as told, « stored » by default, and keeps what it received.
class FakeServer {
  readonly received: { sha256: string; bytes: number; retention: string; token: string }[] = [];
  readonly answers = new Map<string, MediaAnswer>();
  offline = false;

  readonly transport = async (media: { sha256: string; bytes: Uint8Array; contentType: string; retention: string }, token: string): Promise<MediaAnswer> => {
    if (this.offline) return 'unreachable';
    this.received.push({ sha256: media.sha256, bytes: media.bytes.length, retention: media.retention, token });
    return this.answers.get(media.sha256) ?? 'stored';
  };
}

describe('Les médias attendent le réseau', () => {
  let factory: IDBFactory;
  let queue: MediaQueue;
  let server: FakeServer;

  beforeEach(async () => {
    factory = new IDBFactory();
    queue = await MediaQueue.open(factory);
    server = new FakeServer();
  });

  it("une photo est gardée sur le téléphone avant tout envoi, sous l'empreinte calculée ici", async () => {
    const bytes = photo('trois morts');

    const fingerprint = await queue.keep(OUSMANE, bytes, 'image/jpeg', 'OperationalProof');

    expect(fingerprint).toBe(await sha256(bytes));
    expect(await queue.waiting(OUSMANE)).toEqual([{ sha256: fingerprint, state: 'pending' }]);
  });

  it("elle survit à la fermeture de l'application", async () => {
    const fingerprint = await queue.keep(OUSMANE, photo('trois morts'), 'image/jpeg', 'OperationalProof');
    queue.close();

    const reopened = await MediaQueue.open(factory);

    expect(await reopened.waiting(OUSMANE)).toEqual([{ sha256: fingerprint, state: 'pending' }]);
  });

  it('au retour du réseau, elle part sous le compte de son auteur, avec sa classe ; bien reçue, elle s’efface du téléphone', async () => {
    const morts = await queue.keep(OUSMANE, photo('trois morts'), 'image/jpeg', 'OperationalProof');
    const pv = await queue.keep(OUSMANE, photo('le PV'), 'image/jpeg', 'SupportingDocument');

    const report = await synchronizeMedia(queue, active(), server.transport);

    expect(report).toEqual({ sent: 2, refused: 0, stopped: null });
    expect(server.received.map(({ sha256: fingerprint, retention, token }) => [fingerprint, retention, token])).toEqual([
      [morts, 'OperationalProof', `jeton-${OUSMANE}`],
      [pv, 'SupportingDocument', `jeton-${OUSMANE}`],
    ]);
    expect(await queue.waiting(OUSMANE)).toEqual([]);
    expect(await queue.bytesWaiting()).toBe(0);
  });

  it('« déjà là » (envoyée, puis la réponse perdue) compte comme reçue : effacée, jamais renvoyée', async () => {
    const fingerprint = await queue.keep(OUSMANE, photo('trois morts'), 'image/jpeg', 'OperationalProof');
    server.answers.set(fingerprint, 'already-there');

    await synchronizeMedia(queue, active(), server.transport);
    await synchronizeMedia(queue, active(), server.transport);

    expect(server.received).toHaveLength(1);
    expect(await queue.waiting(OUSMANE)).toEqual([]);
  });

  it('sans réseau, rien ne s’efface : la photo repart à la synchro suivante', async () => {
    const fingerprint = await queue.keep(OUSMANE, photo('trois morts'), 'image/jpeg', 'OperationalProof');
    server.offline = true;

    expect(await synchronizeMedia(queue, active(), server.transport)).toEqual({ sent: 0, refused: 0, stopped: 'Offline' });
    expect(await queue.waiting(OUSMANE)).toEqual([{ sha256: fingerprint, state: 'pending' }]);

    server.offline = false;
    await synchronizeMedia(queue, active(), server.transport);
    expect(server.received.map(({ sha256: sent }) => sent)).toEqual([fingerprint]);
  });

  it('refusée par le serveur, elle est gardée et marquée refusée, jamais renvoyée ; la suivante part quand même', async () => {
    const refusee = await queue.keep(OUSMANE, photo('illisible'), 'image/jpeg', 'OperationalProof');
    const suivante = await queue.keep(OUSMANE, photo('trois morts'), 'image/jpeg', 'OperationalProof');
    server.answers.set(refusee, 'refused');

    expect(await synchronizeMedia(queue, active(), server.transport)).toEqual({ sent: 1, refused: 1, stopped: null });
    await synchronizeMedia(queue, active(), server.transport);

    expect(server.received.map(({ sha256: sent }) => sent)).toEqual([refusee, suivante]);
    expect(await queue.waiting(OUSMANE)).toEqual([{ sha256: refusee, state: 'refused' }]);
  });

  it("une photo ne part que sous le compte de son auteur : celle d'Awa attend Awa", async () => {
    const deAwa = await queue.keep(AWA, photo('chez Awa'), 'image/jpeg', 'OperationalProof');

    await synchronizeMedia(queue, active(OUSMANE), server.transport);
    expect(server.received).toEqual([]);

    await synchronizeMedia(queue, active(AWA), server.transport);
    expect(server.received.map(({ sha256: sent, token }) => [sent, token])).toEqual([[deAwa, `jeton-${AWA}`]]);
  });

  it('la même photo gardée deux fois ne prend la place qu’une fois et ne part qu’une fois', async () => {
    const bytes = photo('trois morts');
    await queue.keep(OUSMANE, bytes, 'image/jpeg', 'OperationalProof');
    await queue.keep(OUSMANE, bytes, 'image/jpeg', 'OperationalProof');

    expect(await queue.bytesWaiting()).toBe(bytes.length);
    await synchronizeMedia(queue, active(), server.transport);
    expect(server.received).toHaveLength(1);
  });

  it('près de la borne, regarder deux fois la même photo ne la fait pas refuser : elle est déjà gardée', async () => {
    const small = await MediaQueue.open(new IDBFactory(), 40);
    const bytes = photo('une photo de 26 octets ok');
    const first = await small.keep(OUSMANE, bytes, 'image/jpeg', 'OperationalProof');

    await expect(small.keep(OUSMANE, bytes, 'image/jpeg', 'OperationalProof')).resolves.toBe(first);
  });

  it("au-delà de la borne, une nouvelle photo n'est pas gardée et le dit ; aucune photo en attente n'est effacée pour faire de la place", async () => {
    const small = await MediaQueue.open(new IDBFactory(), 40);
    const premiere = await small.keep(OUSMANE, photo('une photo de 26 octets ok'), 'image/jpeg', 'OperationalProof');

    await expect(small.keep(OUSMANE, photo('une seconde photo trop lourde'), 'image/jpeg', 'OperationalProof')).rejects.toBeInstanceOf(MediaQueueFull);
    expect(await small.waiting(OUSMANE)).toEqual([{ sha256: premiere, state: 'pending' }]);
  });

  it('sans session, rien ne part', async () => {
    await queue.keep(OUSMANE, photo('trois morts'), 'image/jpeg', 'OperationalProof');

    expect(await synchronizeMedia(queue, { status: 'none' }, server.transport)).toEqual({ sent: 0, refused: 0, stopped: 'NoSession' });
    expect(server.received).toEqual([]);
  });
});
