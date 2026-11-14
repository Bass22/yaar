/**
 * The publisher's base of cost categories: the same for every farm from its creation, changed
 * only by a release, never deleted. Farm cost types (N.2) hang under one of them, which keeps
 * analyses comparable across farms.
 */
export type CostCategory =
  | 'Feed'
  | 'Chicks'
  | 'Health'
  | 'Bedding'
  | 'Labour'
  | 'Equipment'
  | 'Cleaning'
  | 'Transport'
  /** After slaughter: plucking, freezing. Empty for a farm that sells live birds. */
  | 'Processing'
  | 'Utilities'
  | 'FinancialCharges'
  | 'Other';

/** Variable: grows with the number of birds. Fixed: paid whatever the headcount. */
export type CostBehaviour = 'Fixed' | 'Variable';

export interface CostCategoryEntry {
  readonly category: CostCategory;
  readonly behaviour: CostBehaviour;
  /** Goes through order → delivery; every other cost is entered directly. */
  readonly orderable: boolean;
}

const entry = (category: CostCategory, behaviour: CostBehaviour, orderable: boolean): CostCategoryEntry =>
  Object.freeze({ category, behaviour, orderable });

export const COST_CATEGORIES: readonly CostCategoryEntry[] = Object.freeze([
  entry('Feed', 'Variable', true),
  entry('Chicks', 'Variable', true),
  entry('Health', 'Variable', true),
  entry('Bedding', 'Variable', true),
  entry('Labour', 'Fixed', false),
  entry('Equipment', 'Fixed', false),
  entry('Cleaning', 'Fixed', false),
  entry('Transport', 'Variable', false),
  entry('Processing', 'Variable', false),
  entry('Utilities', 'Variable', false),
  entry('FinancialCharges', 'Fixed', false),
  entry('Other', 'Variable', false),
]);

/**
 * The list every broiler farm starts with (founder's decision, 2026-11-09): one type per category
 * of the base, checked; Processing's two unchecked — not every farm processes. Unchecked means
 * archived: offered nowhere until checked. User-facing names.
 */
/** The stage of a feed by the age of the flock (N.9): the caretaker tells the bags apart by its colour. */
export const FEED_STAGES = Object.freeze(['Starter', 'Grower', 'Finisher'] as const);
export type FeedStage = (typeof FEED_STAGES)[number];

// `bagWeight`: the usual weight of a bag of this feed, in grams (N.8a); none outside feed.
// `feedStage`: only the three feeds by age have one (N.9).
const startingType = (name: string, category: CostCategory, checked: boolean, bagWeight: number | null = null, feedStage: FeedStage | null = null) =>
  Object.freeze({ name, category, bagWeight, feedStage, checked });

export const DEFAULT_COST_TYPES: readonly { readonly name: string; readonly category: CostCategory; readonly bagWeight: number | null; readonly feedStage: FeedStage | null; readonly checked: boolean }[] = Object.freeze([
  // The feed changes with the age of the flock (N.7, decision of 2026-11-13): three types, each
  // ordered, received and counted on its own.
  startingType('Aliment démarrage', 'Feed', true, 50_000, 'Starter'),
  startingType('Aliment croissance', 'Feed', true, 50_000, 'Grower'),
  startingType('Aliment finition', 'Feed', true, 50_000, 'Finisher'),
  startingType('Poussins', 'Chicks', true),
  startingType('Vaccins et soins', 'Health', true),
  startingType('Copeaux', 'Bedding', true),
  startingType('Salaire du gardien', 'Labour', true),
  startingType('Équipement', 'Equipment', true),
  startingType('Nettoyage et désinfection', 'Cleaning', true),
  startingType('Transport', 'Transport', true),
  startingType('Eau et électricité', 'Utilities', true),
  startingType('Frais financiers', 'FinancialCharges', true),
  startingType('Autres', 'Other', true),
  startingType('Déplumage', 'Processing', false),
  startingType('Congélation', 'Processing', false),
  // Feed bought by weight, rare (decision of 2026-11-13): written 1 × the total price. Last.
  // Its bag opened still counts 50 kg in the feed eaten: accepted while rare.
  startingType('Aliment au kg', 'Feed', true),
]);
