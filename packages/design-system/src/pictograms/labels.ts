import type { PictogramName } from './generated/pictogram-names';

/**
 * The accessible name of each pictogram, in French: read by a screen reader, and the words the
 * voice says for it. A pictogram added to the sources gets its name here, or the typecheck fails.
 */
export const PICTOGRAM_LABELS: Readonly<Record<PictogramName, string>> = {
  'bag-bundle': 'Paquet de quatre sacs',
  barn: 'Poulailler',
  bicarbonate: 'Bicarbonate',
  camera: 'Photo',
  'camera-white': 'Photo',
  caretaker: 'Gardien',
  check: 'Oui',
  chick: 'Poussin',
  'closed-bag': 'Sac fermé',
  cross: 'Non',
  'dead-chicken': 'Poulet mort',
  drinker: 'Abreuvoir',
  hen: 'Poule',
  'hot-sun': 'Forte chaleur',
  microphone: 'Message vocal',
  'microphone-white': 'Message vocal',
  moon: 'Nuit',
  'open-bag': "Sac d'aliment ouvert",
  paper: 'Papier signé',
  pencil: 'Corriger',
  question: 'À vérifier',
  'received-bags': 'Sacs reçus',
  'round-check': 'Fait',
  scale: 'Balance',
  speaker: 'Écouter',
  'stamp-done': 'Bien envoyé',
  'stamp-pending': "En attente d'envoi",
  sun: 'Soleil',
  'sync-cloud': 'Envoi',
  syringe: 'Vaccin',
};
