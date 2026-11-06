import { err, ok, type Result } from '@kit';
import type { Role } from '@domain/journal';

export type PinRefusal =
  | { readonly kind: 'InvalidPin'; readonly expectedDigits: number }
  /** One digit repeated, or digits that follow one another either way: the first guesses anyone makes. */
  | { readonly kind: 'TrivialPin' };

// The caretaker remembers four digits; the admin, who opens the money figures, types six.
const DIGITS: Readonly<Record<Role, number>> = { admin: 6, collaborator: 4 };

/**
 * A PIN as typed, checked against the length its role requires. It is deliberately not a
 * plain string: printed, serialised or interpolated — in a log, an error, a JSON response —
 * it shows a placeholder. Only `reveal()` gives the digits, and only the hasher calls it.
 */
class SecretPin {
  readonly #digits: string;

  constructor(digits: string) {
    this.#digits = digits;
  }

  reveal(): string {
    return this.#digits;
  }

  toString(): string {
    return '[PIN]';
  }

  toJSON(): string {
    return '[PIN]';
  }
}

export type Pin = SecretPin;

/** A refusal never echoes what was typed. */
export const Pin = (raw: unknown, role: Role): Result<Pin, PinRefusal> => {
  const expectedDigits = Object.hasOwn(DIGITS, role) ? DIGITS[role] : 0;
  if (typeof raw !== 'string' || expectedDigits === 0 || raw.length !== expectedDigits || !/^[0-9]+$/.test(raw)) {
    return err({ kind: 'InvalidPin', expectedDigits });
  }
  if (isTrivial(raw)) {
    return err({ kind: 'TrivialPin' });
  }
  return ok(new SecretPin(raw));
};

function isTrivial(digits: string): boolean {
  const steps = [...digits].slice(1).map((digit, index) => Number(digit) - Number(digits[index]));
  return steps.every((step) => step === 0) || steps.every((step) => step === 1) || steps.every((step) => step === -1);
}
