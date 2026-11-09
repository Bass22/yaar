/** Which side of the ledger a counterparty stands on; it never changes once created. */
export const COUNTERPARTY_KINDS = Object.freeze(['Supplier', 'Customer', 'Collaborator'] as const);
export type CounterpartyKind = (typeof COUNTERPARTY_KINDS)[number];

/**
 * The face of a counterparty: the picture of a real object, so that the office shows who it is
 * without reading. A closed list; `paper` is « other ». No photograph in V1 (decision of 2026-11-09).
 */
export const COUNTERPARTY_FACES = Object.freeze(['closed-bag', 'chick', 'syringe', 'truck', 'caretaker', 'hen', 'drinker', 'barn', 'paper'] as const);
export type CounterpartyFace = (typeof COUNTERPARTY_FACES)[number];
