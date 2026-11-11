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
const startingType = (name: string, category: CostCategory, checked: boolean) => Object.freeze({ name, category, checked });

export const DEFAULT_COST_TYPES: readonly { readonly name: string; readonly category: CostCategory; readonly checked: boolean }[] = Object.freeze([
  startingType('Aliment', 'Feed', true),
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
]);
