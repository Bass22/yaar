// The price catalog of the office (N.5): the prices the farm knows, to propose — never to impose.

/** A price known for an article: paid on an order to a supplier, or set by the admin (for all: `supplierId: null`). */
export interface KnownPriceView {
  readonly costTypeId: string;
  readonly supplierId: string | null;
  /** Whole units of `currency`. */
  readonly unitPrice: number;
  /** When it was paid or set, UTC. */
  readonly at: string;
}

export interface PriceCatalogView {
  readonly currency: string;
  readonly prices: readonly KnownPriceView[];
}

export interface SetCatalogPriceRequest {
  /** Created by the office (UUID). */
  readonly id: string;
  readonly costTypeId: string;
  /** The supplier it is for; `null`: for every supplier. */
  readonly supplierId: string | null;
  /** Whole units, zero allowed. */
  readonly unitPrice: number;
}

export type CatalogPriceRefusal =
  | { readonly kind: 'InvalidRequest' }
  | { readonly kind: 'UnknownCostType' }
  | { readonly kind: 'UnknownSupplier' }
  | { readonly kind: 'InvalidPrice' }
  | { readonly kind: 'CatalogPriceAlreadySet' };
