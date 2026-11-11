import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform, type Readable, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// The media volume (M.1, architecture §7). Adapted from build-track (document-store.ts): the
// fingerprint announced by the phone is checked against the bytes, and only images pass.

/** A photo reduced to ~800 px weighs a few hundred kilobytes: 2 MB is generous, and bounded. */
export const MEDIA_MAX_BYTES = 2 * 1024 * 1024;

export type MediaContentType = 'image/jpeg' | 'image/png' | 'image/webp';

export type StoreOutcome =
  | { readonly kind: 'Stored'; readonly sha256: string; readonly byteSize: number; readonly contentType: MediaContentType }
  | { readonly kind: 'TooLarge' }
  | { readonly kind: 'UnsupportedType' }
  | { readonly kind: 'FingerprintMismatch' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
/** Enough for the longest signature below (WebP: `RIFF` + 4-byte size + `WEBP`). */
const SNIFF_LENGTH = 12;

/** Why a write was abandoned midway: mapped to an outcome, never surfaced as a fault. */
class Refused extends Error {
  constructor(readonly outcome: StoreOutcome) {
    super(outcome.kind);
  }
}

/**
 * `<root>/<tenant>/<ab>/<cd>/<sha256>`. The server never alters a byte and no name from the
 * client reaches the disk. Streamed to a temporary file on the same volume while the digest and
 * the size are computed, then renamed at once: nothing is assembled in memory. Content-addressed
 * per farm: the same file twice is one file. Never removed (rule 13).
 */
export class MediaStore {
  constructor(
    private readonly root: string,
    private readonly maxBytes: number = MEDIA_MAX_BYTES,
  ) {}

  async write(tenantId: string, announced: string, source: Readable): Promise<StoreOutcome> {
    assertShape(tenantId, UUID);
    assertShape(announced, SHA256);
    const temporaryDir = join(this.root, '.tmp');
    await mkdir(temporaryDir, { recursive: true });
    const temporary = join(temporaryDir, randomUUID());

    const hash = createHash('sha256');
    let byteSize = 0;
    let head = Buffer.alloc(0);
    let contentType: MediaContentType | undefined;
    const maxBytes = this.maxBytes;

    const inspect = new Transform({
      transform(chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback): void {
        byteSize += chunk.length;
        if (byteSize > maxBytes) {
          done(new Refused({ kind: 'TooLarge' }));
          return;
        }
        if (contentType === undefined && head.length < SNIFF_LENGTH) {
          head = Buffer.concat([head, chunk.subarray(0, SNIFF_LENGTH - head.length)]);
          if (head.length >= SNIFF_LENGTH) {
            contentType = sniffContentType(head);
            if (contentType === undefined) {
              done(new Refused({ kind: 'UnsupportedType' }));
              return;
            }
          }
        }
        hash.update(chunk);
        done(null, chunk);
      },
    });

    // The source is piped, not part of the pipeline: a refusal must not destroy it — when it is
    // a request, that would cut the socket before the refusal can be answered.
    const sink = pipeline(inspect, createWriteStream(temporary));
    const forwardError = (error: Error): void => {
      inspect.destroy(error);
    };
    source.on('error', forwardError);
    source.pipe(inspect);
    try {
      await sink;
    } catch (error) {
      source.unpipe(inspect);
      await unlink(temporary).catch(() => undefined);
      if (error instanceof Refused) return error.outcome;
      throw error;
    } finally {
      source.off('error', forwardError);
    }

    // A file shorter than the sniffing window is judged on what it has.
    contentType ??= sniffContentType(head);
    const sha256 = hash.digest('hex');
    if (contentType === undefined || sha256 !== announced) {
      await unlink(temporary);
      return { kind: contentType === undefined ? 'UnsupportedType' : 'FingerprintMismatch' };
    }
    const destination = this.pathOf(tenantId, sha256);
    await mkdir(join(destination, '..'), { recursive: true });
    if (await this.exists(tenantId, sha256)) {
      // Same content already there: keep the published copy, drop ours.
      await unlink(temporary);
    } else {
      await rename(temporary, destination);
    }
    return { kind: 'Stored', sha256, byteSize, contentType };
  }

  async exists(tenantId: string, sha256: string): Promise<boolean> {
    // Resolved outside the try: a malformed segment is a fault, not a missing file.
    const path = this.pathOf(tenantId, sha256);
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  /** The bytes, streamed. The caller checks `exists` first: a missing file is not a fault. */
  read(tenantId: string, sha256: string): Readable {
    return createReadStream(this.pathOf(tenantId, sha256));
  }

  private pathOf(tenantId: string, sha256: string): string {
    assertShape(tenantId, UUID);
    assertShape(sha256, SHA256);
    return join(this.root, tenantId, sha256.slice(0, 2), sha256.slice(2, 4), sha256);
  }
}

/**
 * The images a phone sends, decided on the leading bytes only — never on the extension nor on
 * the announced type, which the sender controls. Anything else is refused (fail-closed): SVG and
 * HTML in particular, which would execute; sounds wait for the voice messages (M.4).
 */
export function sniffContentType(head: Uint8Array): MediaContentType | undefined {
  if (startsWith(head, 0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(head, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(head, 0, [0x52, 0x49, 0x46, 0x46]) && startsWith(head, 8, [0x57, 0x45, 0x42, 0x50])) return 'image/webp';
  return undefined;
}

function startsWith(head: Uint8Array, offset: number, signature: readonly number[]): boolean {
  return signature.every((byte, index) => head[offset + index] === byte);
}

/** A path segment that is not exactly what it claims to be is a fault, never a path. */
function assertShape(value: string, shape: RegExp): void {
  if (!shape.test(value)) {
    throw new Error(`Path segment refused: "${value}"`);
  }
}
