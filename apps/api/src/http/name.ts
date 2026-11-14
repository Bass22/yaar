import { err, ok, type Result } from '@kit';

/** The longest name of a site, a counterparty or a cost type, once trimmed. */
const NAME_MAX = 60;

/** A name as the admin typed it: trimmed, neither empty nor longer than 60 characters. */
export function nameOf(raw: string): Result<string, { readonly kind: 'InvalidName' }> {
  const name = raw.trim();
  return name === '' || name.length > NAME_MAX ? err({ kind: 'InvalidName' }) : ok(name);
}
