import { TestBed } from '@angular/core/testing';
import type { AudioLanguage } from '@contracts';
import { clip, counted } from './phrase';
import { AUDIO_OUTPUT, CLIP_SOURCE, Voice, type AudioOutput, type ClipManifest, type ClipSource } from './voice';

// Spec: backlog I.2 — les clips se jouent hors-ligne ; CLAUDE.md §4 règle 11 (clips
// pré-enregistrés, jamais de synthèse vocale) ; décision du 2026-11-07 (la langue suit la personne).

const tokenFor = (sub: string) => `e30.${btoa(JSON.stringify({ sub })).replace(/=+$/, '')}.c2ln`;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
// A clip's bytes say which clip it is, so that what is played can be read back.
const bytesOf = (name: string) => new TextEncoder().encode(name).buffer as ArrayBuffer;
const nameOf = (buffer: ArrayBuffer) => new TextDecoder().decode(buffer);

class FakeSource implements ClipSource {
  readonly fetched: string[] = [];
  readonly delays = new Map<string, Promise<void>>();
  unreachable = false;
  constructor(public manifests: Partial<Record<AudioLanguage, ClipManifest>>) {}
  async manifest(language: AudioLanguage): Promise<ClipManifest> {
    if (this.unreachable) {
      throw new Error('offline');
    }
    return this.manifests[language] ?? { version: 'none', clips: [] };
  }
  async clip(language: AudioLanguage, id: string): Promise<ArrayBuffer> {
    this.fetched.push(`${language}/${id}`);
    await this.delays.get(id);
    if (this.unreachable) {
      throw new Error('offline');
    }
    return bytesOf(`${language}/${id}`);
  }
}

class FakeOutput implements AudioOutput {
  readonly heard: string[][] = [];
  stops = 0;
  async play(clips: readonly ArrayBuffer[]): Promise<void> {
    this.heard.push(clips.map(nameOf));
  }
  stop(): void {
    this.stops++;
  }
}

describe("La voix de l'application", () => {
  let source: FakeSource;
  let output: FakeOutput;

  const signedIn = (language: AudioLanguage) =>
    localStorage.setItem('yaar.session', JSON.stringify({ token: tokenFor('u'), expiresAt: '2099-01-01T00:00:00.000Z', role: 'collaborator', account: { name: 'Ousmane', avatar: null, language } }));
  const start = () => {
    TestBed.configureTestingModule({ providers: [{ provide: CLIP_SOURCE, useValue: source }, { provide: AUDIO_OUTPUT, useValue: output }] });
    return TestBed.inject(Voice);
  };

  beforeEach(() => {
    localStorage.clear();
    source = new FakeSource({
      fr: { version: 'fr-1', clips: ['deaths-today-3', 'deaths-many', 'number-40', 'number-2', 'confirm'] },
      wo: { version: 'wo-1', clips: ['deaths-today-3', 'confirm'] },
    });
    output = new FakeOutput();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it("une phrase se dit dans la langue de la personne connectée, ses clips enchaînés dans l'ordre", async () => {
    signedIn('wo');
    await start().say([counted('deaths-today', 3, 'deaths-many'), clip('confirm')]);

    expect(output.heard).toEqual([['wo/deaths-today-3', 'wo/confirm']]);
  });

  it("avant toute connexion, ou pour le compte choisi à l'entrée, la langue se donne à la phrase", async () => {
    const voice = start();
    await voice.say([clip('confirm')]);
    await voice.say([clip('confirm')], 'wo');

    expect(output.heard).toEqual([['fr/confirm'], ['wo/confirm']]);
  });

  it('une nouvelle phrase coupe celle qui se dit : la première, arrivée en retard, ne se dit plus', async () => {
    signedIn('fr');
    const voice = start();
    let release = () => undefined as void;
    source.delays.set('deaths-many', new Promise<void>((resolve) => (release = resolve)));

    const first = voice.say([counted('deaths-today', 42, 'deaths-many')]);
    await settle();
    await voice.say([clip('confirm')]);
    release();
    await first;

    expect(output.heard).toEqual([['fr/confirm']]);
    expect(output.stops).toBe(2);
  });

  it("une phrase qui n'est pas enregistrée entière ne se dit pas du tout, et la voix dit ce qui manque", async () => {
    signedIn('wo');
    const voice = start();
    await voice.say([counted('deaths-today', 42, 'deaths-many'), clip('confirm')]);

    expect(output.heard).toEqual([]);
    expect(voice.missing()).toEqual({ kind: 'MissingClips', language: 'wo', missing: ['deaths-many', 'number-42'] });
  });

  it("sans réseau et sans clip gardé, rien ne se dit et rien ne casse : le picto et la couleur restent", async () => {
    signedIn('fr');
    const voice = start();
    source.unreachable = true;

    await expect(voice.say([clip('confirm')])).resolves.toBeUndefined();
    expect(output.heard).toEqual([]);
  });

  it("une fois connecté, tous les clips de sa langue sont chargés une fois, pour que le service worker les garde : pas ceux de l'autre langue", async () => {
    signedIn('fr');
    start();
    await vi.waitFor(() => expect(source.fetched).toHaveLength(5));

    expect(source.fetched.every((id) => id.startsWith('fr/'))).toBe(true);
    expect(localStorage.getItem('yaar.audio')).toBe('fr:fr-1');
  });

  it("à la prochaine ouverture, des clips déjà chargés ne le sont pas de nouveau ; un nouvel enregistrement l'est", async () => {
    localStorage.setItem('yaar.audio', 'fr:fr-1');
    signedIn('fr');
    const voice = start();
    await voice.prepare('fr');
    expect(source.fetched).toEqual([]);

    source.manifests.fr = { version: 'fr-2', clips: ['confirm'] };
    TestBed.resetTestingModule();
    await start().prepare('fr');
    expect(source.fetched).toEqual(['fr/confirm']);
  });

  it('un clip déjà chargé ne se charge pas deux fois', async () => {
    const voice = start();
    await voice.say([clip('confirm')]);
    await voice.say([clip('confirm')]);

    expect(source.fetched.filter((id) => id === 'fr/confirm')).toHaveLength(1);
  });
});
