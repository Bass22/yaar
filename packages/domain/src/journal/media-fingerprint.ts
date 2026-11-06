import { err, ok, type Brand, type Result } from '@kit';
import type { Refusal } from './refusal';

/**
 * The SHA-256 of a photo or a voice message, in lowercase hexadecimal. An event names its media
 * by this fingerprint, so it can leave before the file does. The domain checks the spelling and
 * never computes a fingerprint.
 */
export type MediaFingerprint = Brand<string, 'MediaFingerprint'>;

const SHA_256_HEX = /^[0-9a-f]{64}$/;

export const MediaFingerprint = (raw: unknown): Result<MediaFingerprint, Refusal> =>
  typeof raw === 'string' && SHA_256_HEX.test(raw) ? ok(raw as MediaFingerprint) : err({ kind: 'InvalidMediaFingerprint' });
