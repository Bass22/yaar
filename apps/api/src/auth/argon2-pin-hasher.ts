import { argon2id, hash, verify } from 'argon2';
import type { Pin } from './pin';
import type { PinHash, PinHasher } from './pin-hasher';

// OWASP's minimum for argon2id: 19 MiB of memory, two passes, one lane. A PIN has so few
// combinations that no setting resists someone holding the digest: what protects an account
// is the count of attempts (pin-attempts.ts) and the fact that digests never leave the server.
const PARAMETERS = { type: argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export class Argon2PinHasher implements PinHasher {
  async hash(pin: Pin): Promise<PinHash> {
    return (await hash(pin.reveal(), PARAMETERS)) as PinHash;
  }

  async verify(digest: PinHash, pin: Pin): Promise<boolean> {
    // Anything that is not an argon2id digest is refused before the library reads it.
    if (typeof digest !== 'string' || !digest.startsWith('$argon2id$')) {
      return false;
    }
    try {
      return await verify(digest, pin.reveal());
    } catch {
      return false;
    }
  }
}
