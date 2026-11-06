/**
 * ISO 4217 currency code (`XOF` for the CFA franc). Amounts stay neutral: the currency
 * is always carried by the amount and read from the product's settings, never
 * hard-coded in a calculation.
 */
export type CurrencyCode = string;
