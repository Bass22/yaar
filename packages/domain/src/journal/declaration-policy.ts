import { err, ok, type Result } from '@kit';
import type { SiteId, UserId } from './ids';
import type { JournalEvent } from './journal-event';
import type { Refusal } from './refusal';
import type { Role } from './role';

/** The person who signs the event. */
export type Author = { readonly id: UserId; readonly role: Role };

/** Who keeps the notebook of a site, and how tightly the admin chose to hold it. */
export type SiteStaff = {
  readonly siteId: SiteId;
  /** The caretaker in charge of the site; `null` while none is named. */
  readonly primaryCaretaker: UserId | null;
  /** The other caretakers allowed to write in the notebook of the site. */
  readonly substitutes: readonly UserId[];
  /** A choice of the admin, off by default: only the primary caretaker declares. */
  readonly strictMode: boolean;
};

export type DeclarationPolicyContext = {
  readonly author: Author;
  readonly site: SiteStaff;
};

/**
 * Says whether the author may write this event in the notebook of the site. The notebook
 * belongs to the site: its primary caretaker and its substitutes declare alike, unless the
 * admin turned strict mode on. The admin always may, and signs with their own name.
 */
export const authorizeDeclaration = <Event extends JournalEvent>(
  event: Event,
  context: DeclarationPolicyContext,
): Result<Event, Refusal> => {
  const { author, site } = context;
  if (author.id !== event.authorId || site.siteId !== event.siteId) {
    throw new TypeError('A declaration is judged with its own author and the staff of its own site.');
  }
  if (author.role === 'admin') {
    return ok(event);
  }
  // Only the admin and the caretakers write in a notebook: any other role is refused, even
  // if it was listed in the staff of the site by mistake.
  if (author.role !== 'collaborator') {
    return err({ kind: 'RoleCannotDeclare' });
  }
  if (event.type === 'Loss') {
    return err({ kind: 'LossByAdminOnly' });
  }
  const isPrimary = site.primaryCaretaker === author.id;
  if (!isPrimary && !site.substitutes.includes(author.id)) {
    return err({ kind: 'NotAssignedToSite' });
  }
  if (site.strictMode && !isPrimary) {
    return err({ kind: 'StrictModePrimaryOnly' });
  }
  return ok(event);
};
