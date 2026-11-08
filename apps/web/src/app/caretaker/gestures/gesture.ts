import type { ScriptClip } from '../../core/audio/script-clips';
import type { PhrasePart } from '../../core/audio/phrase';
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
};
