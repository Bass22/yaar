// The publisher's base, as the office reads it (N.1, N.4): the same for every farm, never on the
// caretaker phone.

export type CostCategoryCode =
  | 'Feed'
  | 'Chicks'
  | 'Health'
  | 'Bedding'
  | 'Labour'
  | 'Equipment'
  | 'Cleaning'
  | 'Transport'
  | 'Processing'
  | 'Utilities'
  | 'FinancialCharges'
  | 'Other';

export interface CostCategoryView {
  readonly category: CostCategoryCode;
  /** Variable: grows with the number of birds. Fixed: paid whatever the headcount. */
  readonly behaviour: 'Fixed' | 'Variable';
  /** Goes through order → delivery; every other cost is entered directly. */
  readonly orderable: boolean;
}

/** Deaths, then the losses that are not deaths. */
export type LossTypeCode = 'Death' | 'Missing' | 'Donation' | 'Theft';

/** A strain of the publisher; its curve stays on the server until a screen needs it. */
export interface StrainView {
  readonly strain: 'Cobb500';
  readonly name: string;
  readonly species: 'Broiler';
}

export interface ReferenceData {
  readonly costCategories: readonly CostCategoryView[];
  readonly lossTypes: readonly LossTypeCode[];
  readonly strains: readonly StrainView[];
}
