import type { SessionState } from '../session/session-store';

/** What the office writes while the network may be missing (architecture §5, P.7). */
export type OfficeEntryKind = 'cost' | 'payment' | 'settlement' | 'sale' | 'saleReceipt';

/** Where an office entry stands: waiting to leave, or refused by the server and kept with its reason. Sent entries are gone. */
export type OfficeEntryState = 'pending' | 'refused';

export type OfficeEntry = {
  /** Order of writing on the device. */
  readonly seq: number;
  /** The identifier of what is written (cost, payment, settlement), made at the office. */
  readonly id: string;
  /** Who wrote it: it only ever leaves under this account. */
  readonly authorId: string;
  readonly kind: OfficeEntryKind;
  readonly url: string;
  readonly body: { readonly id: string } & Readonly<Record<string, unknown>>;
  /** What it belongs to, for the screens: a campaign, an order, a counterparty. */
  readonly subject: string;
  readonly state: OfficeEntryState;
  readonly refusal?: string;
};

/** What the server said of one entry: kept (new or already there), refused with its reason, or no answer. */
export type OfficeAnswer = { readonly kind: 'sent' } | { readonly kind: 'refused'; readonly refusal: string } | { readonly kind: 'unreachable' } | { readonly kind: 'unauthorized' };

export type OfficeTransport = (url: string, body: OfficeEntry['body'], token: string) => Promise<OfficeAnswer>;

export type OfficeSyncReport = { readonly sent: number; readonly refused: number; readonly stopped: 'Offline' | 'NoSession' | 'SessionExpired' | null };

const DATABASE = 'yaar-office';
const STORE = 'entries';

/**
 * The office's queue (P.7): a money entry is kept here, on the device, before any call — apart
 * from the notebook's outbox, which a caretaker's session reads. Sent, it leaves the device;
 * refused, it stays with its reason until the admin has seen it.
 */
export class OfficeQueue {
  private constructor(private readonly db: IDBDatabase) {}

  static async open(factory: IDBFactory = indexedDB): Promise<OfficeQueue> {
    const db = await done<IDBDatabase>(() => {
      const request = factory.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(STORE, { keyPath: 'seq', autoIncrement: true });
        store.createIndex('id', 'id', { unique: true });
      };
      return request;
    });
    return new OfficeQueue(db);
  }

  close(): void {
    this.db.close();
  }

  /** Keeps an entry of this account, pending. Resolves once it is stored: only then may the screen show it. */
  async keep(authorId: string, kind: OfficeEntryKind, url: string, body: OfficeEntry['body'], subject: string): Promise<void> {
    await this.write((store) => store.add({ id: body.id, authorId, kind, url, body, subject, state: 'pending' }));
  }

  /** This account's entries, pending and refused, in the order they were written. */
  async entries(authorId: string): Promise<OfficeEntry[]> {
    const all = (await done(() => this.db.transaction(STORE, 'readonly').objectStore(STORE).getAll())) as OfficeEntry[];
    return all.filter((entry) => entry.authorId === authorId).sort((a, b) => a.seq - b.seq);
  }

  /** A refusal the admin has seen leaves the list; a pending entry never does. */
  async dismiss(id: string): Promise<void> {
    await this.change(id, (entry) => (entry.state === 'refused' ? null : entry), true);
  }

  /** @internal The server has it. */
  async sent(id: string): Promise<void> {
    await this.change(id, () => null, true);
  }

  /** @internal The server refused it: kept, never sent again. */
  async refused(id: string, refusal: string): Promise<void> {
    await this.change(id, (entry) => ({ ...entry, state: 'refused', refusal }), false);
  }

  private async change(id: string, update: (entry: OfficeEntry) => OfficeEntry | null, removeOnNull: boolean): Promise<void> {
    const transaction = this.db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    const entry = (await done(() => store.index('id').get(id))) as OfficeEntry | undefined;
    if (entry !== undefined) {
      const next = update(entry);
      if (next === null && removeOnNull) store.delete(entry.seq);
      else if (next !== null && next !== entry) store.put(next);
    }
    await committed(transaction);
  }

  private async write(work: (store: IDBObjectStore) => IDBRequest): Promise<void> {
    const transaction = this.db.transaction(STORE, 'readwrite');
    work(transaction.objectStore(STORE));
    await committed(transaction);
  }
}

/**
 * Sends what this account left in the office's queue, in the order written (P.7). Kept by the
 * server — new, or already there — it leaves the device; refused, it is kept with its reason and
 * never sent again; without an answer, everything waits for the next time.
 */
export async function synchronizeOffice(queue: OfficeQueue, session: SessionState, transport: OfficeTransport): Promise<OfficeSyncReport> {
  if (session.status === 'none') return { sent: 0, refused: 0, stopped: 'NoSession' };
  if (session.status === 'expired') return { sent: 0, refused: 0, stopped: 'SessionExpired' };
  let sent = 0;
  let refused = 0;
  for (const entry of (await queue.entries(session.userId)).filter(({ state }) => state === 'pending')) {
    const answer = await transport(entry.url, entry.body, session.token);
    if (answer.kind === 'unreachable') return { sent, refused, stopped: 'Offline' };
    if (answer.kind === 'unauthorized') return { sent, refused, stopped: 'SessionExpired' };
    if (answer.kind === 'refused') {
      await queue.refused(entry.id, answer.refusal);
      refused += 1;
    } else {
      await queue.sent(entry.id);
      sent += 1;
    }
  }
  return { sent, refused, stopped: null };
}

function done<T>(start: () => IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = start();
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error);
  });
}

// A write counts once its transaction is committed: before that, a crash would lose it.
function committed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
