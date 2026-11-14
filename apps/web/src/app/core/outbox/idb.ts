// IndexedDB, as the phone's queues use it (G.2, M.3, P.7): a request answered, a transaction committed.

export function done<T>(start: () => IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = start();
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error);
  });
}

// A write counts once its transaction is committed: before that, a crash would lose it.
export function committed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
