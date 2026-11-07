import type { JournalEventPayload, JournalRefusal } from '@contracts';

/** An event before it has an identifier: the outbox gives it one, once (CLAUDE.md §4 rule 2). */
export type EventDraft = JournalEventPayload extends infer Payload ? (Payload extends unknown ? Omit<Payload, 'id'> : never) : never;

/**
 * Where an event stands on the phone: `pending` never left; `in-doubt` a sending was tried and
 * got no answer — it leaves again, identical, and no longer changes; `sent` the server has it
 * (accepted or already had it); `refused` the server said no, and it is not sent again.
 */
export type OutboxState = 'pending' | 'in-doubt' | 'sent' | 'refused';

export type OutboxEntry = {
  /** Order of creation on the phone. */
  readonly seq: number;
  readonly id: string;
  /** Who wrote it: it only ever leaves under this account (decision of 2026-11-07). */
  readonly authorId: string;
  readonly payload: JournalEventPayload;
  readonly state: OutboxState;
  readonly refusal?: JournalRefusal;
};

/** The phone's storage could not keep the event: the user is told, nothing is shown as written. */
export class OutboxUnavailable extends Error {
  constructor(cause: unknown) {
    super('The outbox cannot be read or written on this phone.', { cause });
  }
}

const DATABASE = 'yaar';
const STORE = 'outbox';

/**
 * The outbox of the phone (Architecture §5): every declaration is kept here before any network
 * call, in IndexedDB, so that it survives closing the application and restarting the phone.
 * A promise resolves only once the write is committed: nothing is shown as written before.
 */
export class Outbox {
  private constructor(private readonly db: IDBDatabase) {}

  static async open(factory: IDBFactory = indexedDB, name = DATABASE): Promise<Outbox> {
    try {
      const db = await done<IDBDatabase>(() => {
        const request = factory.open(name, 1);
        request.onupgradeneeded = () => {
          const store = request.result.createObjectStore(STORE, { keyPath: 'seq', autoIncrement: true });
          store.createIndex('id', 'id', { unique: true });
        };
        return request;
      });
      return new Outbox(db);
    } catch (error) {
      throw new OutboxUnavailable(error);
    }
  }

  close(): void {
    this.db.close();
  }

  /** Keeps a new event, pending, under an identifier made here — once, at creation. */
  async record(authorId: string, draft: EventDraft): Promise<OutboxEntry> {
    const id = crypto.randomUUID();
    const entry = { id, authorId, payload: { ...draft, id } as JournalEventPayload, state: 'pending' as const };
    const seq = await this.write((store) => store.add(entry));
    return { seq: seq as number, ...entry };
  }

  /** Replaces what a pending event says — only while it never left. Returns whether it did. */
  async replace(id: string, draft: EventDraft): Promise<boolean> {
    return this.update(id, (entry) => (entry.state === 'pending' ? { ...entry, payload: { ...draft, id } as JournalEventPayload } : null));
  }

  async markInDoubt(ids: readonly string[]): Promise<void> {
    for (const id of ids) {
      await this.update(id, (entry) => (entry.state === 'pending' || entry.state === 'in-doubt' ? { ...entry, state: 'in-doubt' } : null));
    }
  }

  async markSent(ids: readonly string[]): Promise<void> {
    for (const id of ids) {
      await this.update(id, (entry) => ({ ...entry, state: 'sent' }));
    }
  }

  async markRefused(id: string, refusal: JournalRefusal): Promise<void> {
    await this.update(id, (entry) => ({ ...entry, state: 'refused', refusal }));
  }

  /** What is left to send for this account, in the order of creation. */
  async toSend(authorId: string): Promise<OutboxEntry[]> {
    return (await this.all()).filter((entry) => entry.authorId === authorId && (entry.state === 'pending' || entry.state === 'in-doubt'));
  }

  async refused(authorId: string): Promise<OutboxEntry[]> {
    return (await this.all()).filter((entry) => entry.authorId === authorId && entry.state === 'refused');
  }

  /** How many events of this account wait to leave: the count of the sync badge. */
  async waiting(authorId: string): Promise<number> {
    return (await this.toSend(authorId)).length;
  }

  private async all(): Promise<OutboxEntry[]> {
    const entries = await this.read((store) => store.getAll());
    return (entries as OutboxEntry[]).sort((a, b) => a.seq - b.seq);
  }

  private async update(id: string, change: (entry: OutboxEntry) => OutboxEntry | null): Promise<boolean> {
    try {
      const transaction = this.db.transaction(STORE, 'readwrite');
      const store = transaction.objectStore(STORE);
      const entry = (await done(() => store.index('id').get(id))) as OutboxEntry | undefined;
      const changed = entry === undefined ? null : change(entry);
      if (changed !== null) {
        store.put(changed);
      }
      await committed(transaction);
      return changed !== null;
    } catch (error) {
      throw new OutboxUnavailable(error);
    }
  }

  private async write(work: (store: IDBObjectStore) => IDBRequest): Promise<IDBValidKey> {
    try {
      const transaction = this.db.transaction(STORE, 'readwrite');
      const key = done<IDBValidKey>(() => work(transaction.objectStore(STORE)));
      await committed(transaction);
      return await key;
    } catch (error) {
      throw new OutboxUnavailable(error);
    }
  }

  private async read(work: (store: IDBObjectStore) => IDBRequest): Promise<unknown> {
    try {
      return await done(() => work(this.db.transaction(STORE, 'readonly').objectStore(STORE)));
    } catch (error) {
      throw new OutboxUnavailable(error);
    }
  }
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
