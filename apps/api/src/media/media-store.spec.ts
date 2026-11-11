import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { MediaStore } from './media-store';

// Spec: backlog M.1 — un média se dépose par son empreinte ; architecture §7 « Le dépôt » (décision
// du 2026-11-11). Repris de build-track (document-store.spec.ts) : le serveur ne change aucun
// octet, l'empreinte SHA-256 est le nom du fichier, l'écriture se fait en flux vers un temporaire
// du même volume puis un renommage.

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const ELEVAGE_A = uuid(10);
const ELEVAGE_B = uuid(11);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('une photo de morts au sol'), Buffer.from([0xff, 0xd9])]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('un PV de reception')]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x10, 0, 0, 0]), Buffer.from('WEBPVP8 une photo')]);

/** A source that arrives in small chunks, the way a request body does. */
function enMorceaux(bytes: Buffer, size = 3): Readable {
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < bytes.length; offset += size) {
    chunks.push(bytes.subarray(offset, offset + size));
  }
  return Readable.from(chunks);
}

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

/** Every regular file under `root`, relative: what is actually on the disk. */
async function fichiersSous(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(root.length + 1))
    .sort();
}

describe('Le dépôt des médias', () => {
  let root: string;
  let store: MediaStore;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'yaar-media-'));
    store = new MediaStore(root, 64);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('stocke les octets tels quels, sous leur empreinte, rangés par élevage', async () => {
    const outcome = await store.write(ELEVAGE_A, sha256(JPEG), enMorceaux(JPEG));

    const digest = sha256(JPEG);
    expect(outcome).toEqual({ kind: 'Stored', sha256: digest, byteSize: JPEG.length, contentType: 'image/jpeg' });
    const path = `${ELEVAGE_A}/${digest.slice(0, 2)}/${digest.slice(2, 4)}/${digest}`;
    expect(await fichiersSous(root)).toEqual([path]);
    expect(await readFile(join(root, path))).toEqual(JPEG);
  });

  it('JPEG, PNG et WebP passent, reconnus à leurs premiers octets', async () => {
    const outcomes = await Promise.all([JPEG, PNG, WEBP].map((bytes) => store.write(ELEVAGE_A, sha256(bytes), enMorceaux(bytes, 2))));

    expect(outcomes.map((outcome) => (outcome.kind === 'Stored' ? outcome.contentType : outcome.kind))).toEqual(['image/jpeg', 'image/png', 'image/webp']);
  });

  it('le même fichier déposé deux fois ne stocke qu’un fichier, et répond pareil', async () => {
    const first = await store.write(ELEVAGE_A, sha256(JPEG), enMorceaux(JPEG));
    const second = await store.write(ELEVAGE_A, sha256(JPEG), enMorceaux(JPEG, 7));

    expect(second).toEqual(first);
    expect(await fichiersSous(root)).toHaveLength(1);
  });

  it("deux élevages qui déposent la même photo ne partagent rien : l'unicité est par élevage", async () => {
    await store.write(ELEVAGE_A, sha256(JPEG), enMorceaux(JPEG));
    await store.write(ELEVAGE_B, sha256(JPEG), enMorceaux(JPEG));

    const digest = sha256(JPEG);
    expect(await fichiersSous(root)).toEqual([ELEVAGE_A, ELEVAGE_B].map((farm) => `${farm}/${digest.slice(0, 2)}/${digest.slice(2, 4)}/${digest}`).sort());
  });

  it("un fichier dont l'empreinte n'est pas celle annoncée est refusé, et rien ne reste sur le disque", async () => {
    const outcome = await store.write(ELEVAGE_A, sha256(PNG), enMorceaux(JPEG));

    expect(outcome).toEqual({ kind: 'FingerprintMismatch' });
    expect(await fichiersSous(root)).toEqual([]);
  });

  it('au-delà du plafond, le fichier est refusé et rien ne reste ; pile au plafond, il passe', async () => {
    const tooBig = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(62, 0x20)]);
    const exactly = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(61, 0x20)]);

    expect(await store.write(ELEVAGE_A, sha256(tooBig), enMorceaux(tooBig, 16))).toEqual({ kind: 'TooLarge' });
    expect(await fichiersSous(root)).toEqual([]);
    expect((await store.write(ELEVAGE_A, sha256(exactly), enMorceaux(exactly))).kind).toBe('Stored');
  });

  it("ni un PDF, ni un SVG, ni un son : ce qui n'est pas une image attendue est refusé, et rien ne reste", async () => {
    const pdf = Buffer.from('%PDF-1.7\nun bon\n%%EOF');
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
    const ogg = Buffer.from('OggS\u0000\u0002un vocal');

    const outcomes = await Promise.all([pdf, svg, ogg].map((bytes) => store.write(ELEVAGE_A, sha256(bytes), enMorceaux(bytes, 2))));

    expect(outcomes).toEqual([{ kind: 'UnsupportedType' }, { kind: 'UnsupportedType' }, { kind: 'UnsupportedType' }]);
    expect(await fichiersSous(root)).toEqual([]);
  });

  it('se relit en flux, et dit quand un fichier manque', async () => {
    await store.write(ELEVAGE_A, sha256(JPEG), enMorceaux(JPEG));

    const chunks: Buffer[] = [];
    for await (const chunk of store.read(ELEVAGE_A, sha256(JPEG))) {
      chunks.push(chunk as Buffer);
    }
    expect(Buffer.concat(chunks)).toEqual(JPEG);
    expect(await store.exists(ELEVAGE_A, sha256(Buffer.from('rien')))).toBe(false);
    expect(await store.exists(ELEVAGE_B, sha256(JPEG))).toBe(false);
  });

  it("refuse un identifiant d'élevage ou une empreinte qui ne sont pas les leurs : aucune traversée de chemin", async () => {
    await expect(store.write('../../etc', sha256(JPEG), enMorceaux(JPEG))).rejects.toThrow();
    await expect(store.write(ELEVAGE_A, '../../../passwd', enMorceaux(JPEG))).rejects.toThrow();
    await expect(store.exists(ELEVAGE_A, '../../../passwd')).rejects.toThrow();
  });
});
