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

/** Types every farm starts with, under a category of the base (decision of 2026-11-09). User-facing names. */
export const DEFAULT_COST_TYPES: readonly { readonly name: string; readonly category: CostCategory }[] = Object.freeze([
  Object.freeze({ name: 'Déplumage', category: 'Processing' as const }),
  Object.freeze({ name: 'Congélation', category: 'Processing' as const }),
]);
