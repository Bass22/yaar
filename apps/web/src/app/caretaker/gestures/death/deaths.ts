import type { NotebookDay } from '../../notebook/notebook-view';
import { readBackOf, type Confirmation, type Gesture, type ReadBack } from '../gesture';

const PHRASES: ReadBack = {
  said: { today: 'deaths-today', yesterday: 'deaths-yesterday', dayBeforeYesterday: 'deaths-before-yesterday' },
  saidMany: 'deaths-many',
  alreadyWritten: 'already-written',
  alreadyWrittenMany: 'already-written-many',
  inAddition: 'deaths-in-addition',
  inAdditionMany: 'deaths-in-addition-many',
  counted: (count) => (count > 1 ? `${count} poulets morts` : `${count} poulet mort`),
  before: (written) => (written > 1 ? `Il y a déjà ${written} morts écrits pour ce jour.` : 'Il y a déjà 1 mort écrit pour ce jour.'),
  mine: (count) => (count > 1 ? `Tes ${count} morts, c’est en plus ?` : 'Ton mort, c’est en plus ?'),
};

/** The read-back of a death declaration (K.1), with the sum of the deaths already written that day. */
export function confirmationOf(count: number, when: NotebookDay['when'], alreadyWritten: number | null): Confirmation {
  return readBackOf(PHRASES, count, when, alreadyWritten);
}

/** Deaths: one lying chicken drawn per unit; more deaths than live chickens is written like any other (C.5). */
export const DEATHS: Gesture = {
  fact: 'Death',
  name: 'death',
  picto: 'dead-chicken',
  label: 'Mort',
  title: 'Combien de morts ?',
  unit: 'mort',
  howMany: 'deaths-how-many',
  confirmationOf,
};
