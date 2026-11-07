import { Injectable, InjectionToken, computed, effect, inject, signal } from '@angular/core';
import type { AudioLanguage } from '@contracts';
import { AuthService } from '../session/auth';
import { compose, type MissingClips, type PhrasePart } from './phrase';

/** What tools/build-audio.mjs writes next to the clips of a language: what is recorded, and a version that changes with any clip. */
export type ClipManifest = { readonly version: string; readonly clips: readonly string[] };

/** Where the clips come from: the application's own files, cached by the service worker (ngsw-config.json, group « audio »). */
export interface ClipSource {
  manifest(language: AudioLanguage): Promise<ClipManifest>;
  clip(language: AudioLanguage, id: string): Promise<ArrayBuffer>;
}

/** Where they are heard. */
export interface AudioOutput {
  /** Plays the clips one after the other, without a gap; resolves when the last one ends or is stopped. */
  play(clips: readonly ArrayBuffer[]): Promise<void>;
  stop(): void;
}

const fetchSource: ClipSource = {
  async manifest(language) {
    const response = await fetch(`audio/${language}/manifest.json`);
    if (!response.ok) {
      throw new Error(`No clip manifest for ${language}: ${response.status}`);
    }
    return (await response.json()) as ClipManifest;
  },
  async clip(language, id) {
    const response = await fetch(`audio/${language}/${id}.webm`);
    if (!response.ok) {
      throw new Error(`No clip ${language}/${id}: ${response.status}`);
    }
    return response.arrayBuffer();
  },
};

export const CLIP_SOURCE = new InjectionToken<ClipSource>('CLIP_SOURCE', { providedIn: 'root', factory: () => fetchSource });
export const AUDIO_OUTPUT = new InjectionToken<AudioOutput>('AUDIO_OUTPUT', { providedIn: 'root', factory: () => new WebAudioOutput() });

const WARMED_KEY = 'yaar.audio';

/**
 * The voice of the application (backlog I.2): pre-recorded clips only — never the browser's
 * speech synthesis (CLAUDE.md §4 rule 11). It speaks the language of the person signed in, or the
 * one asked for (on the entry screens, the language of the account chosen). A new phrase cuts
 * the one being said. A phrase it cannot say whole is not said, and `missing` tells what lacks.
 */
@Injectable({ providedIn: 'root' })
export class Voice {
  private readonly auth = inject(AuthService);
  private readonly source = inject(CLIP_SOURCE);
  private readonly output = inject(AUDIO_OUTPUT);
  private readonly manifests = new Map<AudioLanguage, Promise<ClipManifest>>();
  private readonly clips = new Map<string, Promise<ArrayBuffer>>();
  private turn = 0;

  /** The language of the person signed in; French before anyone is. */
  readonly language = computed((): AudioLanguage => {
    const session = this.auth.session();
    return session.status === 'none' ? 'fr' : session.account.language;
  });
  /** The last phrase that could not be said whole, for whoever checks the recordings. */
  readonly missing = signal<MissingClips | null>(null);

  constructor() {
    // Once someone is signed in, every clip of their language is fetched once, so that the
    // service worker keeps them all and the notebook speaks without network.
    effect(() => {
      if (this.auth.session().status !== 'none') {
        void this.prepare(this.language());
      }
    });
  }

  async say(parts: readonly PhrasePart[], language: AudioLanguage = this.language()): Promise<void> {
    const turn = ++this.turn;
    this.output.stop();
    try {
      const manifest = await this.manifestOf(language);
      const phrase = compose(parts, language, new Set(manifest.clips));
      if (!phrase.ok) {
        this.missing.set(phrase.error);
        console.warn(`[voice] not said, clips missing in ${language}: ${phrase.error.missing.join(', ')}`);
        return;
      }
      const clips = await Promise.all(phrase.value.map((id) => this.clipOf(language, id)));
      if (turn === this.turn) {
        await this.output.play(clips);
      }
    } catch (error) {
      // No clip, no voice: the picto and the colour still say it. Never a cut phrase, never a crash.
      console.warn('[voice] could not speak', error);
    }
  }

  stop(): void {
    this.turn++;
    this.output.stop();
  }

  /** Fetches every clip of a language once per version of its recordings. */
  async prepare(language: AudioLanguage): Promise<void> {
    try {
      const manifest = await this.manifestOf(language);
      const warmed = `${language}:${manifest.version}`;
      if (readWarmed() === warmed || manifest.clips.length === 0) {
        return;
      }
      for (const id of manifest.clips) {
        await this.clipOf(language, id);
      }
      writeWarmed(warmed);
    } catch (error) {
      console.warn('[voice] clips not prepared', error);
    }
  }

  private manifestOf(language: AudioLanguage): Promise<ClipManifest> {
    let manifest = this.manifests.get(language);
    if (manifest === undefined) {
      manifest = this.source.manifest(language);
      manifest.catch(() => this.manifests.delete(language));
      this.manifests.set(language, manifest);
    }
    return manifest;
  }

  private clipOf(language: AudioLanguage, id: string): Promise<ArrayBuffer> {
    const key = `${language}/${id}`;
    let clip = this.clips.get(key);
    if (clip === undefined) {
      clip = this.source.clip(language, id);
      clip.catch(() => this.clips.delete(key));
      this.clips.set(key, clip);
    }
    return clip;
  }
}

function readWarmed(): string | null {
  try {
    return globalThis.localStorage?.getItem(WARMED_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeWarmed(value: string): void {
  try {
    globalThis.localStorage?.setItem(WARMED_KEY, value);
  } catch {
    // Only costs fetching the clips again next time.
  }
}

/**
 * Web Audio: the clips are decoded, then started back to back on the audio clock — no gap
 * between them, which an <audio> element per clip would leave. The context is opened at the
 * first phrase, after a tap, as browsers require.
 */
export class WebAudioOutput implements AudioOutput {
  private context: AudioContext | null = null;
  private playing: AudioBufferSourceNode[] = [];
  private generation = 0;

  async play(clips: readonly ArrayBuffer[]): Promise<void> {
    const mine = ++this.generation;
    this.context ??= new AudioContext();
    const context = this.context;
    if (context.state === 'suspended') {
      await context.resume();
    }
    // decodeAudioData takes the buffer over: a copy keeps the cached clip whole.
    const buffers = await Promise.all(clips.map((clip) => context.decodeAudioData(clip.slice(0))));
    if (mine !== this.generation) {
      return; // a newer phrase, or a stop, came while decoding
    }
    this.silence();
    let at = context.currentTime + 0.02;
    const sources = buffers.map((buffer) => {
      const node = context.createBufferSource();
      node.buffer = buffer;
      node.connect(context.destination);
      node.start(at);
      at += buffer.duration;
      return node;
    });
    this.playing = sources;
    const last = sources.at(-1);
    if (last !== undefined) {
      await new Promise<void>((resolve) => (last.onended = () => resolve()));
    }
  }

  stop(): void {
    this.generation++;
    this.silence();
  }

  private silence(): void {
    for (const node of this.playing) {
      try {
        node.stop();
      } catch {
        // Already ended.
      }
    }
    this.playing = [];
  }
}
