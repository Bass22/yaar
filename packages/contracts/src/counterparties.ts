// The farm's counterparties, as the office reads and writes them (N.3). Never on the caretaker's phone.

export type CounterpartyKindCode = 'Supplier' | 'Customer' | 'Collaborator';

/** A pictogram of a closed list: the face of the counterparty. */
export type CounterpartyFaceCode = 'closed-bag' | 'chick' | 'syringe' | 'truck' | 'caretaker' | 'hen' | 'drinker' | 'barn' | 'paper' | 'shop';

export interface CounterpartyView {
  readonly id: string;
  readonly kind: CounterpartyKindCode;
  readonly name: string;
  readonly face: CounterpartyFaceCode;
  /** May advance money for the farm (R.7): only such counterparties are offered as « paid by ». */
  readonly advancesExpenses: boolean;
  /** Archived: no longer offered, still readable wherever it appears. */
  readonly archived: boolean;
}

export interface CreateCounterpartyRequest {
  /** Created by the office (UUID). */
  readonly id: string;
  readonly kind: CounterpartyKindCode;
  readonly name: string;
  readonly face: CounterpartyFaceCode;
  /** Absent: no (R.7). */
  readonly advancesExpenses?: boolean;
}

/** At least one; the kind never changes. */
export interface ConfigureCounterpartyRequest {
  readonly name?: string;
  readonly face?: CounterpartyFaceCode;
  readonly advancesExpenses?: boolean;
}

export type CounterpartyRefusal =
  | { readonly kind: 'InvalidRequest' }
  | { readonly kind: 'InvalidName' }
  | { readonly kind: 'CounterpartyAlreadyExists' }
  | { readonly kind: 'CounterpartyNotFound' };
