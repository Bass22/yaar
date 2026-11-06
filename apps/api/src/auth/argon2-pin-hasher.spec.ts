import { unwrap } from '@kit';
import { argon2i, hash } from 'argon2';
import { Argon2PinHasher } from './argon2-pin-hasher';
import { Pin } from './pin';
import type { PinHash } from './pin-hasher';

// Spec: Archi §6 — PIN haché en argon2 ; backlog E.1 — argon2id derrière un port, le PIN ne
// sort jamais. Tourne sur la vraie bibliothèque : un faux hacheur ne prouverait rien.

const hasher = new Argon2PinHasher();

describe('Hachage du PIN', () => {
  let pinDuGardien: Pin;
  let unAutrePin: Pin;
  let pinDeLAdmin: Pin;

  // Built before each test: a broken PIN rule fails named tests instead of the whole file.
  beforeEach(() => {
    pinDuGardien = unwrap(Pin('4829', 'collaborator'));
    unAutrePin = unwrap(Pin('4820', 'collaborator'));
    pinDeLAdmin = unwrap(Pin('482913', 'admin'));
  });

  it("un PIN est stocké haché en argon2id, jamais en clair", async () => {
    const digest = await hasher.hash(pinDuGardien);

    expect(digest).toMatch(/^\$argon2id\$v=19\$/);
    expect(digest).not.toContain('4829');
  });

  it("le hachage respecte au moins le coût minimal recommandé : 19 Mio de mémoire, deux passes", async () => {
    const digest = await hasher.hash(pinDeLAdmin);
    const [, memory, passes, lanes] = /\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(digest) ?? [];

    expect(Number(memory)).toBeGreaterThanOrEqual(19_456);
    expect(Number(passes)).toBeGreaterThanOrEqual(2);
    expect(Number(lanes)).toBeGreaterThanOrEqual(1);
  });

  it('un PIN correct est reconnu ; un PIN incorrect ne l’est pas', async () => {
    const digest = await hasher.hash(pinDuGardien);

    expect(await hasher.verify(digest, pinDuGardien)).toBe(true);
    expect(await hasher.verify(digest, unAutrePin)).toBe(false);
    expect(await hasher.verify(digest, pinDeLAdmin)).toBe(false);
  });

  it("le même PIN haché deux fois donne deux empreintes différentes : on ne reconnaît pas deux comptes au même PIN", async () => {
    const first = await hasher.hash(pinDuGardien);
    const second = await hasher.hash(pinDuGardien);

    expect(first).not.toBe(second);
    expect(await hasher.verify(second, pinDuGardien)).toBe(true);
  });

  it("seul argon2id est accepté : une empreinte argon2i du bon PIN n'est pas reconnue", async () => {
    // Given une empreinte valide du bon PIN, mais produite par une autre variante de l'algorithme
    const otherVariant = (await hash('4829', { type: argon2i })) as PinHash;

    expect(await hasher.verify(otherVariant, pinDuGardien)).toBe(false);
  });

  it("une empreinte illisible, vide ou d'un autre algorithme ne reconnaît aucun PIN, sans lever d'erreur", async () => {
    const unreadable = ['', '4829', 'pas-une-empreinte', '$argon2id$', '$argon2i$v=19$m=19456,t=2,p=1$c2Fsc2Fsc2Fs$aGFzaGhhc2hoYXNo', '$2b$10$abcdefghijklmnopqrstuv'];

    for (const digest of unreadable) {
      await expect(hasher.verify(digest as PinHash, pinDuGardien)).resolves.toBe(false);
    }
  });
});
