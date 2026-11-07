/** The part of `navigator.storage` this needs. */
export type StorageManagerLike = Pick<StorageManager, 'persisted' | 'persist'>;

/**
 * Asks the browser not to purge the application's storage under pressure: the outbox lives
 * there (Architecture §5). Asked once, at start; a browser that lacks the API or refuses does
 * not stop the application — the answer is just no.
 */
export async function requestPersistentStorage(storage: StorageManagerLike | undefined): Promise<boolean> {
  try {
    if (storage === undefined) {
      return false;
    }
    return (await storage.persisted()) || (await storage.persist());
  } catch {
    return false;
  }
}
