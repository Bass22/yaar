import { BadRequestException } from '@nestjs/common';

/** A request body that is a plain object, else refused as `InvalidRequest`: the fields are read one by one after (white list). */
export function objectOf(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException({ kind: 'InvalidRequest' });
  }
  return body as Record<string, unknown>;
}
