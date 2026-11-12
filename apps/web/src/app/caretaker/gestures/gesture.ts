import type { CountedFamily, ScriptClip } from '../../core/audio/script-clips';
import { clip, counted, type PhrasePart } from '../../core/audio/phrase';
import type { PictogramName } from '@design-system';
import type { GestureTone } from '../../ui/gesture-button';
import type { PileKind } from '../../ui/pile';
import type { NotebookDay } from '../notebook/notebook-view';

/** What the confirmation says before the Oui: the voice, and the same in words for whoever reads. */
export type Confirmation = {
  readonly phrase: readonly PhrasePart[];
  /** « 3 poulets morts aujourd'hui ? » */
  readonly words: string;
  /** The reminder when the same type is already written that day, `null` otherwise. */
  readonly already: string | null;
};

/**
 * A gesture of the notebook that counts what changed state (K.1, K.2): the same three taps for
 * every type, only what is drawn, said and written differs.
 */
export type Gesture = {
  readonly fact: 'Death' | 'BagOpened';
  /** The host class of the gesture: `death`, `bag`. */
  readonly name: GestureTone & PileKind;
  readonly picto: PictogramName;
  readonly label: string;
  readonly title: string;
  readonly unit: string;
  readonly howMany: ScriptClip;
  readonly confirmationOf: (count: number, when: NotebookDay['when'], alreadyWritten: number | null) => Confirmation;
  /** The read-back asks whether the caretaker shows what was counted (K.6): the dead only. */
  readonly photographed?: true;
};

/** The phrases recorded whole stop here; beyond, « c'est en plus ? » no longer says the number, just said. */
const WHOLE_UP_TO = 20;
const DAY_WORD = { today: "aujourd'hui", yesterday: 'hier', dayBeforeYesterday: 'avant-hier' } as const;

/** The clips of a read-back, and its words: what differs between deaths and opened bags. */
export type ReadBack = {
  readonly said: Record<NotebookDay['when'], CountedFamily>;
  readonly saidMany: ScriptClip;
  readonly alreadyWritten: CountedFamily;
  readonly alreadyWrittenMany: ScriptClip;
  readonly inAddition: CountedFamily;
  readonly inAdditionMany: ScriptClip;
  /** « 3 poulets morts », « 1 sac ouvert » */
  readonly counted: (count: number) => string;
  /** « Il y a déjà 3 sacs ouverts écrits pour ce jour. » */
  readonly before: (alreadyWritten: number) => string;
  /** « Tes 2 sacs, c’est en plus ? » */
  readonly mine: (count: number) => string;
};

/**
 * The read-back before the Oui (K.1, K.3). When the same type is already written that day — by
 * this caretaker or another — the voice says their sum only, then asks whether these are in
 * addition, instead of « c'est bien ça ? » (decision of 2026-11-08).
 */
export function readBackOf(phrases: ReadBack, count: number, when: NotebookDay['when'], alreadyWritten: number | null): Confirmation {
  const said = counted(phrases.said[when], count, phrases.saidMany);
  const words = `${phrases.counted(count)} ${DAY_WORD[when]} ?`;
  if (alreadyWritten === null) {
    return { phrase: [said, clip('confirm')], words, already: null };
  }
  const inAddition = count <= WHOLE_UP_TO ? counted(phrases.inAddition, count) : clip(phrases.inAdditionMany);
  return {
    phrase: [said, counted(phrases.alreadyWritten, alreadyWritten, phrases.alreadyWrittenMany), inAddition],
    words,
    already: `${phrases.before(alreadyWritten)} ${phrases.mine(count)}`,
  };
}
