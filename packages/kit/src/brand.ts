declare const brand: unique symbol;

/**
 * Nominal typing for a structural language: `Brand<string, 'SiteId'>` is a string that
 * only code holding the right to cast can produce, so two keys are never confused at
 * compile time. The brand exists in the types only; the runtime value is untouched.
 */
export type Brand<T, B extends string> = T & { readonly [brand]: B };
