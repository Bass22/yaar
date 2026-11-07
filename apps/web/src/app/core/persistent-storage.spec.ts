import { requestPersistentStorage } from './persistent-storage';

// Spec: backlog G.1 — le stockage persistant est demandé à l'installation ; Archi §5 (protéger
// l'outbox d'une purge du navigateur).
describe('Stockage persistant', () => {
  it("demande au navigateur de ne pas purger le stockage de l'application, s'il ne l'a pas déjà accordé", async () => {
    const persist = vi.fn(async () => true);

    expect(await requestPersistentStorage({ persisted: async () => false, persist })).toBe(true);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("ne redemande pas ce qui est déjà accordé", async () => {
    const persist = vi.fn(async () => true);

    expect(await requestPersistentStorage({ persisted: async () => true, persist })).toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it("un navigateur sans cette fonction, ou qui refuse, ne bloque pas le démarrage : la réponse est simplement non", async () => {
    expect(await requestPersistentStorage(undefined)).toBe(false);
    expect(await requestPersistentStorage({ persisted: async () => false, persist: async () => false })).toBe(false);
    expect(await requestPersistentStorage({ persisted: async () => { throw new Error('denied'); }, persist: async () => true })).toBe(false);
  });
});
