import { err, ok, type Result } from '@kit';
import type { Prisma } from '@prisma/client';
import type { AccountAvatar, AudioLanguage, UpdateAccountRequest } from '@contracts';
import { isCanonicalUuid } from '@domain/journal';

/** The closed list of avatars (E.9), checked at the border; the database holds the same enum. */
const ACCOUNT_AVATARS = ['baobab', 'mango', 'pirogue', 'teapot', 'calabash', 'sheep', 'goat', 'watermelon', 'fish', 'star', 'turtle', 'drum'] as const satisfies readonly AccountAvatar[];
const AUDIO_LANGUAGES = ['wo', 'fr'] as const satisfies readonly AudioLanguage[];

// Fails the typecheck if the contract gains an avatar or a language this list forgets.
type Forgotten = Exclude<AccountAvatar, (typeof ACCOUNT_AVATARS)[number]> | Exclude<AudioLanguage, (typeof AUDIO_LANGUAGES)[number]>;
const everyValueListed: [Forgotten] extends [never] ? true : never = true;
void everyValueListed;

/** The voice before any choice: French, the language of the first clips (audio/fr/). */
export const DEFAULT_LANGUAGE: AudioLanguage = 'fr';

export const isAvatar = (value: unknown): value is AccountAvatar => (ACCOUNT_AVATARS as readonly unknown[]).includes(value);
export const isLanguage = (value: unknown): value is AudioLanguage => (AUDIO_LANGUAGES as readonly unknown[]).includes(value);

/**
 * The admin changes the avatar or the language of an account of the farm (E.9). A `null`
 * language makes the account follow its site again. Neither the role nor the PIN moves here.
 */
export async function updateAccount(tx: Prisma.TransactionClient, userId: string, change: UpdateAccountRequest): Promise<Result<void, { readonly kind: 'AccountNotFound' }>> {
  if (!isCanonicalUuid(userId)) {
    return err({ kind: 'AccountNotFound' });
  }
  const updated = await tx.user.updateMany({
    where: { id: userId },
    data: { ...(change.avatar === undefined ? {} : { avatar: change.avatar }), ...(change.language === undefined ? {} : { audioLanguage: change.language }) },
  });
  return updated.count === 1 ? ok(undefined) : err({ kind: 'AccountNotFound' });
}

/**
 * The voice of a person: their own language, else that of their site — the one they keep the
 * notebook of as primary caretaker first —, else French (decision of 2026-11-07).
 */
export async function languageOf(tx: Prisma.TransactionClient, userId: string, own: AudioLanguage | null): Promise<AudioLanguage> {
  if (own !== null) {
    return own;
  }
  const sites = await tx.siteAssignment.findMany({ where: { userId }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }], select: { site: { select: { audioLanguage: true } } } });
  return sites.map(({ site }) => site.audioLanguage).find((language) => language !== null) ?? DEFAULT_LANGUAGE;
}
