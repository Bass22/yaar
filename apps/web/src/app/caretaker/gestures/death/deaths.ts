import { clip, counted } from '../../../core/audio/phrase';
import type { NotebookDay } from '../../notebook/notebook-view';
import type { Confirmation, Gesture } from '../gesture';

/** The phrases recorded whole stop here; beyond, « c'est en plus ? » no longer says the number, just said. */
const WHOLE_UP_TO = 20;

const FAMILY = { today: 'deaths-today', yesterday: 'deaths-yesterday', dayBeforeYesterday: 'deaths-before-yesterday' } as const;
const DAY_WORD = { today: "aujourd'hui", yesterday: 'hier', dayBeforeYesterday: 'avant-hier' } as const;

/**
 * The read-back of a death declaration (K.1). When deaths are already written that day — by
 * this caretaker or another — the voice says their sum only, then asks whether these are in
 * addition, instead of « c'est bien ça ? » (decision of 2026-11-08).
 */
export function confirmationOf(count: number, when: NotebookDay['when'], alreadyWritten: number | null): Confirmation {
  const plural = count > 1 ? 's' : '';
  const said = counted(FAMILY[when], count, 'deaths-many');
  const words = `${count} poulet${plural} mort${plural} ${DAY_WORD[when]} ?`;
  if (alreadyWritten === null) {
    return { phrase: [said, clip('confirm')], words, already: null };
  }
  const inAddition = count <= WHOLE_UP_TO ? counted('deaths-in-addition', count) : clip('deaths-in-addition-many');
  const before = alreadyWritten > 1 ? `Il y a déjà ${alreadyWritten} morts écrits pour ce jour.` : 'Il y a déjà 1 mort écrit pour ce jour.';
  const mine = count > 1 ? `Tes ${count} morts, c’est en plus ?` : 'Ton mort, c’est en plus ?';
  return { phrase: [said, counted('already-written', alreadyWritten, 'already-written-many'), inAddition], words, already: `${before} ${mine}` };
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
