import { err, ok, type Result } from '@kit';
import type { AudioLanguage } from '@contracts';
import { NUMBER_RULES } from './numbers';
import type { CountedFamily, ScriptClip } from './script-clips';

/**
 * A piece of what the phone says (backlog I.1). The clips it names come from audio/script.md:
 * an identifier the script does not have does not typecheck.
 */
export type PhrasePart =
  | { readonly kind: 'clip'; readonly clip: ScriptClip }
  /** `deaths-today-3` when recorded whole; else the composed phrase, its number at the end. */
  | { readonly kind: 'counted'; readonly family: CountedFamily; readonly count: number; readonly composed: ScriptClip | null }
  | { readonly kind: 'number'; readonly value: number }
  /** Whole grams, said as « un kilo deux cent cinquante grammes ». */
  | { readonly kind: 'weight'; readonly grams: number };

export const clip = (id: ScriptClip): PhrasePart => ({ kind: 'clip', clip: id });
export const counted = (family: CountedFamily, count: number, composed: ScriptClip | null = null): PhrasePart => ({ kind: 'counted', family, count, composed });
export const number = (value: number): PhrasePart => ({ kind: 'number', value });
export const weight = (grams: number): PhrasePart => ({ kind: 'weight', grams });

/** A phrase that cannot be said whole in this language: what is missing, so that nothing plays cut. */
export type MissingClips = { readonly kind: 'MissingClips'; readonly language: AudioLanguage; readonly missing: readonly string[] };

/**
 * The clips to play, one after the other, for a phrase in a language, given the clips recorded
 * in it. A phrase recorded whole is always preferred: recording one more whole phrase needs no
 * code (decision of 2026-11-07). If any clip is missing, nothing is returned but the list of what
 * is missing — a phrase is never said with a hole in it.
 */
export function compose(parts: readonly PhrasePart[], language: AudioLanguage, recorded: ReadonlySet<string>): Result<string[], MissingClips> {
  const clips: string[] = [];
  const missing: string[] = [];
  const need = (ids: readonly string[]) => {
    clips.push(...ids);
    missing.push(...ids.filter((id) => !recorded.has(id)));
  };
  const numberIn = (value: number): string[] | null => NUMBER_RULES[language]?.(value) ?? null;
  for (const part of parts) {
    switch (part.kind) {
      case 'clip':
        need([part.clip]);
        break;
      case 'counted': {
        const whole = `${part.family}-${part.count}`;
        if (recorded.has(whole) || part.composed === null) {
          need([whole]);
          break;
        }
        const said = numberIn(part.count);
        need(said === null ? [part.composed, `number-${part.count}`] : [part.composed, ...said]);
        break;
      }
      case 'number':
        need(numberIn(part.value) ?? [`number-${part.value}`]);
        break;
      case 'weight':
        need(weightClips(part.grams, numberIn));
        break;
    }
  }
  return missing.length === 0 ? ok(clips) : err({ kind: 'MissingClips', language, missing: [...new Set(missing)] });
}

function weightClips(grams: number, numberIn: (value: number) => string[] | null): string[] {
  const say = (value: number) => numberIn(value) ?? [`number-${value}`];
  const kilos = Math.floor(grams / 1000);
  const rest = grams % 1000;
  const kiloPart = kilos === 0 ? [] : [...say(kilos), kilos === 1 ? 'unit-kilo' : 'unit-kilos'];
  const gramPart = rest === 0 && kilos > 0 ? [] : [...say(rest), 'unit-grams'];
  return [...kiloPart, ...gramPart];
}
