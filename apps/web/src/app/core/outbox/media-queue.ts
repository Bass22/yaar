import type { SessionState } from '../session/session-store';
import { committed, done } from './idb';

/** Says how long a media is kept on the server (architecture §7). */
export type RetentionClass = 'OperationalProof' | 'SupportingDocument';

/** Where a media stands on the phone: waiting to leave, or refused by the server and kept. Received media are gone. */
export type MediaState = 'pending' | 'refused';

type MediaEntry = {
  readonly sha256: string;
  /** Who took it: it only ever leaves under this account. */
  readonly authorId: string;
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly retention: RetentionClass;
  readonly state: MediaState;
  /** Order of keeping on the phone. */
  readonly keptAt: number;
};

/** The media waiting on the phone weigh too much: a new one is not kept, and the screen says so. */
export class MediaQueueFull extends Error {
  constructor() {
    super('The media waiting on this phone take all the room they are given.');
  }
}

/** What the server said of one media: received (new, or already there), refused, or no answer. */
export type MediaAnswer = 'stored' | 'already-there' | 'refused' | 'unreachable' | 'unauthorized';

export type MediaTransport = (media: { readonly sha256: string; readonly bytes: Uint8Array; readonly contentType: string; readonly retention: RetentionClass }, token: string) => Promise<MediaAnswer>;

export type MediaSyncReport = { readonly sent: number; readonly refused: number; readonly stopped: 'Offline' | 'NoSession' | 'SessionExpired' | null };

/** About a hundred photos reduced to ~800 px (decision of 2026-11-11). */
export const MEDIA_QUEUE_MAX_BYTES = 30 * 1024 * 1024;

const DATABASE = 'yaar-media';
const STORE = 'media';

/**
 * The media of the phone waiting for the network (M.2, architecture §5): kept here under their
 * fingerprint before anything leaves, apart from the outbox. A media is removed from the phone
 * only once the server has it; one still waiting is never removed to make room.
 */
export class MediaQueue {
  private constructor(
    private readonly db: IDBDatabase,
    private readonly maxBytes: number,
  ) {}

  static async open(factory: IDBFactory = indexedDB, maxBytes = MEDIA_QUEUE_MAX_BYTES): Promise<MediaQueue> {
    const db = await done<IDBDatabase>(() => {
      const request = factory.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE, { keyPath: ['authorId', 'sha256'] });
      };
      return request;
    });
    return new MediaQueue(db, maxBytes);
  }

  close(): void {
    this.db.close();
  }

  /**
   * Keeps a media of this account and returns its fingerprint, computed here: the event that
   * cites it carries it. The same media kept twice takes its room once.
   */
  async keep(authorId: string, bytes: Uint8Array, contentType: string, retention: RetentionClass): Promise<string> {
    const sha256 = await fingerprintOf(bytes);
    const all = await this.all();
    if (all.some((entry) => entry.authorId === authorId && entry.sha256 === sha256)) {
      return sha256;
    }
    if ((await this.bytesWaiting()) + bytes.length > this.maxBytes) {
      throw new MediaQueueFull();
    }
    const entry: MediaEntry = { sha256, authorId, bytes, contentType, retention, state: 'pending', keptAt: all.length === 0 ? 0 : Math.max(...all.map((one) => one.keptAt)) + 1 };
    await this.write((store) => store.put(entry));
    return sha256;
  }

  /** What this account's media wait for, in the order they were kept: the journal says which have not left. */
  async waiting(authorId: string): Promise<{ readonly sha256: string; readonly state: MediaState }[]> {
    return (await this.all()).filter((entry) => entry.authorId === authorId).map(({ sha256, state }) => ({ sha256, state }));
  }

  /** The room the waiting media take on the phone, refused ones included: they are kept too. */
  async bytesWaiting(): Promise<number> {
    return (await this.all()).reduce((sum, entry) => sum + entry.bytes.length, 0);
  }

  /** @internal The media of this account still to send, in order. */
  async toSend(authorId: string): Promise<MediaEntry[]> {
    return (await this.all()).filter((entry) => entry.authorId === authorId && entry.state === 'pending');
  }

  /** @internal The server has it: it leaves the phone. */
  async received(authorId: string, sha256: string): Promise<void> {
    await this.write((store) => store.delete([authorId, sha256]));
  }

  /** @internal The server refused it: kept, never sent again. */
  async refused(entry: MediaEntry): Promise<void> {
    await this.write((store) => store.put({ ...entry, state: 'refused' }));
  }

  private async all(): Promise<MediaEntry[]> {
    const entries = (await done(() => this.db.transaction(STORE, 'readonly').objectStore(STORE).getAll())) as MediaEntry[];
    return entries.sort((a, b) => a.keptAt - b.keptAt);
  }

  private async write(work: (store: IDBObjectStore) => IDBRequest): Promise<void> {
    const transaction = this.db.transaction(STORE, 'readwrite');
    work(transaction.objectStore(STORE));
    await committed(transaction);
  }
}

/**
 * Sends the media this account left on the phone, one by one, after its events (M.2). Received —
 * new or already there — it is removed from the phone; without an answer it stays and leaves
 * again later; refused, it is kept and never sent again.
 */
export async function synchronizeMedia(queue: MediaQueue, session: SessionState, transport: MediaTransport): Promise<MediaSyncReport> {
  if (session.status === 'none') return { sent: 0, refused: 0, stopped: 'NoSession' };
  if (session.status === 'expired') return { sent: 0, refused: 0, stopped: 'SessionExpired' };
  let sent = 0;
  let refused = 0;
  for (const entry of await queue.toSend(session.userId)) {
    const answer = await transport({ sha256: entry.sha256, bytes: entry.bytes, contentType: entry.contentType, retention: entry.retention }, session.token);
    if (answer === 'unreachable') return { sent, refused, stopped: 'Offline' };
    if (answer === 'unauthorized') return { sent, refused, stopped: 'SessionExpired' };
    if (answer === 'refused') {
      await queue.refused(entry);
      refused += 1;
    } else {
      await queue.received(entry.authorId, entry.sha256);
      sent += 1;
    }
  }
  return { sent, refused, stopped: null };
}

/** The SHA-256 of the bytes, in lowercase hexadecimal: the name of the media on the server. */
export async function fingerprintOf(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
