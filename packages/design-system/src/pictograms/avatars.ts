import type { PictogramName } from './generated/pictogram-names';

/**
 * The closed list of account avatars (E.9, decided on 2026-11-07): twelve drawings of everyday
 * life, none taken from the notebook's own pictograms, each on its own colour — two avatars
 * differ by drawing and by colour. The voice says the name (PICTOGRAM_LABELS). To be validated
 * in the field, on photos, like every pictogram.
 */
export const AVATARS: readonly { readonly name: PictogramName; readonly background: string }[] = [
  { name: 'avatar-baobab', background: '#E4F0E6' },
  { name: 'avatar-mango', background: '#F8EBD8' },
  { name: 'avatar-pirogue', background: '#EAF4FA' },
  { name: 'avatar-teapot', background: '#F5E7C6' },
  { name: 'avatar-calabash', background: '#FCEFC9' },
  { name: 'avatar-sheep', background: '#EFEAF8' },
  { name: 'avatar-goat', background: '#E4F0E6' },
  { name: 'avatar-watermelon', background: '#E4F0E6' },
  { name: 'avatar-fish', background: '#EAF4FA' },
  { name: 'avatar-star', background: '#EFEAF8' },
  { name: 'avatar-turtle', background: '#FCEFC9' },
  { name: 'avatar-drum', background: '#F8E3DD' },
];
