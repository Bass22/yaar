import type { NotebookDay } from '../../notebook/notebook-view';
import { readBackOf, type Confirmation, type Gesture, type ReadBack } from '../gesture';

const PHRASES: ReadBack = {
  said: { today: 'bags-today', yesterday: 'bags-yesterday', dayBeforeYesterday: 'bags-before-yesterday' },
  saidMany: 'bags-many',
  alreadyWritten: 'bags-already-written',
  alreadyWrittenMany: 'bags-already-written-many',
  inAddition: 'bags-in-addition',
  inAdditionMany: 'bags-in-addition-many',
  counted: (count) => (count > 1 ? `${count} sacs ouverts` : `${count} sac ouvert`),
  before: (written) => (written > 1 ? `Il y a déjà ${written} sacs ouverts écrits pour ce jour.` : 'Il y a déjà 1 sac ouvert écrit pour ce jour.'),
  mine: (count) => (count > 1 ? `Tes ${count} sacs, c’est en plus ?` : 'Ton sac, c’est en plus ?'),
};

/** The read-back of opened bags (K.2), with the sum of the bags already written that day (K.3). */
export function bagConfirmationOf(count: number, when: NotebookDay['when'], alreadyWritten: number | null): Confirmation {
  return readBackOf(PHRASES, count, when, alreadyWritten);
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
  confirmationOf: bagConfirmationOf,
};
