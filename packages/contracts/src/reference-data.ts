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

/** A cost type of the farm (N.2), as the office reads it. */
export interface CostTypeView {
  readonly id: string;
  readonly category: CostCategoryCode;
  readonly name: string;
  readonly behaviour: 'Fixed' | 'Variable';
  /** Its category's: only orderable types go through order → delivery. */
  readonly orderable: boolean;
  /** No longer offered; still readable wherever it appears. */
  readonly archived: boolean;
}

export interface CreateCostTypeRequest {
  /** Created by the office (UUID). */
  readonly id: string;
  readonly category: CostCategoryCode;
  readonly name: string;
  /** Its category's when left out. */
  readonly behaviour?: 'Fixed' | 'Variable';
}

/** At least one of the two; the category never changes. */
export interface ConfigureCostTypeRequest {
  readonly name?: string;
  readonly behaviour?: 'Fixed' | 'Variable';
}

export type CostTypeRefusal =
  | { readonly kind: 'InvalidRequest' }
  | { readonly kind: 'InvalidName' }
  | { readonly kind: 'CostTypeAlreadyExists' }
  | { readonly kind: 'CostTypeNotFound' };
