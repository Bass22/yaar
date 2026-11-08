import { clip, counted } from '../../../core/audio/phrase';
import type { NotebookDay } from '../../notebook/notebook-view';
import type { Confirmation, Gesture } from '../gesture';

const FAMILY = { today: 'bags-today', yesterday: 'bags-yesterday', dayBeforeYesterday: 'bags-before-yesterday' } as const;
const DAY_WORD = { today: "aujourd'hui", yesterday: 'hier', dayBeforeYesterday: 'avant-hier' } as const;

/** The read-back of opened bags (K.2). The reminder of the bags already written that day comes with K.3. */
export function bagConfirmationOf(count: number, when: NotebookDay['when']): Confirmation {
  const plural = count > 1 ? 's' : '';
  return {
    phrase: [counted(FAMILY[when], count, 'bags-many'), clip('confirm')],
    words: `${count} sac${plural} ouvert${plural} ${DAY_WORD[when]} ?`,
    already: null,
  };
}

/** A bag OPENED, not a meal: the app computes the feed eaten (CdC « Principes UX fondateurs »). */
export const BAGS: Gesture = {
  fact: 'BagOpened',
  name: 'bag',
  picto: 'open-bag',
  label: 'Sac ouvert',
  title: 'Combien de sacs ouverts ?',
  unit: 'sac',
  howMany: 'bags-how-many',
  confirmationOf: (count, when) => bagConfirmationOf(count, when),
};
