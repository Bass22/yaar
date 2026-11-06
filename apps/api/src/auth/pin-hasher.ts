import type { Brand } from '@kit';
import type { Pin } from './pin';

/** The stored form of a PIN: an argon2id digest with its salt and parameters. Never the PIN. */
export type PinHash = Brand<string, 'PinHash'>;

/** Port: how a PIN becomes a digest, and how a typed PIN is checked against one. */
export interface PinHasher {
  hash(pin: Pin): Promise<PinHash>;
  /** `false` for a wrong PIN, and for a digest that cannot be read: in doubt, the PIN is wrong. */
  verify(hash: PinHash, pin: Pin): Promise<boolean>;
}

export const PIN_HASHER = Symbol('PIN_HASHER');
