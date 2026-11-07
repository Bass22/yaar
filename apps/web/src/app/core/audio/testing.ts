import type { Provider } from '@angular/core';
import type { AudioLanguage } from '@contracts';
import { AUDIO_OUTPUT, CLIP_SOURCE, type AudioOutput, type ClipSource } from './voice';

/**
 * For the tests of a screen: the clips given are « recorded » in every language, and what would
 * be heard is kept as `language/clip` lists, one per phrase. Imported by spec files only.
 */
export function provideHeardVoice(recorded: readonly string[]): { providers: Provider[]; heard: string[][] } {
  const heard: string[][] = [];
  const source: ClipSource = {
    manifest: async () => ({ version: 'test', clips: recorded }),
    clip: async (language: AudioLanguage, id: string) => new TextEncoder().encode(`${language}/${id}`).buffer as ArrayBuffer,
  };
  const output: AudioOutput = {
    play: async (clips) => void heard.push(clips.map((clip) => new TextDecoder().decode(clip))),
    stop: () => undefined,
  };
  return { providers: [{ provide: CLIP_SOURCE, useValue: source }, { provide: AUDIO_OUTPUT, useValue: output }], heard };
}
