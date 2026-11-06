/**
 * Explicit success/failure type for pure code.
 * Business flow never throws: errors are values, and each product names its own.
 */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/**
 * Unwrap a Result that is *expected* to be ok, throwing otherwise. For asserting an
 * invariant that must hold — a test fixture, or a stored row rebuilt into a value:
 * an err here is a bug or data corruption, not a business outcome. `describe`
 * customises the thrown message from the error.
 */
export function unwrap<T, E>(result: Result<T, E>, describe?: (error: E) => string): T {
  if (result.ok) {
    return result.value;
  }
  throw new Error(
    describe ? describe(result.error) : `unwrap on an error Result: ${JSON.stringify(result.error)}`,
  );
}
