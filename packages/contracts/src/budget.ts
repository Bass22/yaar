// The budget of a campaign at the office (S.1, S.3): a plan by category, online only.
import type { CostCategoryCode } from './reference-data';

export interface BudgetLineView {
  readonly category: CostCategoryCode;
  /** The latest written; `null` without a budget — never zero. */
  readonly budget: number | null;
  /** Proposed from the closed campaigns (median of their cost per chick × planned headcount); `null` without one. */
  readonly suggested: number | null;
  readonly committed: number;
  /** `budget − committed`, signed: below zero the category goes beyond; `null` without a budget. */
  readonly variance: number | null;
}

export interface BudgetView {
  readonly campaignId: string;
  readonly currency: string;
  readonly plannedHeadcount: number;
  /** A closed campaign's budget is read, no longer written. */
  readonly closed: boolean;
  /** Every category of the base, in its order. */
  readonly lines: readonly BudgetLineView[];
}

export interface RecordBudgetRequest {
  /** Created by the office (UUID): the identifier of this writing. */
  readonly id: string;
  /** The categories written; `amount: null` takes the budget off a category. */
  readonly lines: readonly { readonly category: CostCategoryCode; readonly amount: number | null }[];
}

export type BudgetRefusal =
  | { readonly kind: 'InvalidRequest' }
  | { readonly kind: 'CampaignNotFound' }
  | { readonly kind: 'CampaignClosed' }
  | { readonly kind: 'BudgetAlreadyRecorded' }
  | { readonly kind: 'UnknownCategory'; readonly category: string }
  | { readonly kind: 'InvalidAmount'; readonly category: string }
  | { readonly kind: 'DuplicateCategory'; readonly category: string };
