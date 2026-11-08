import type { AudioLanguage } from './auth';
// Contract of the routes that set the staff of a site (E.7), admin only:
//   PUT    /api/v1/sites/:siteId/staff/:userId     assign a collaborator, as a substitute
//   DELETE /api/v1/sites/:siteId/staff/:userId     remove them from the site
//   PUT    /api/v1/sites/:siteId/primary-caretaker  designate the primary caretaker
// Each answers 204 with no body.

/** Body of PUT …/primary-caretaker: exactly this field. */
export interface DesignatePrimaryCaretakerRequest {
  readonly userId: string;
}

/**
 * Why a change of staff was refused. A site or an account of another farm does not exist:
 * `SiteNotFound`, `AccountNotFound` (404). An admin reaches every site already and is never
 * assigned: `OnlyCollaboratorsAreAssigned` (403).
 */
export type SiteStaffRefusal =
  | { readonly kind: 'SiteNotFound' }
  | { readonly kind: 'AccountNotFound' }
  | { readonly kind: 'AssignmentNotFound' }
  | { readonly kind: 'OnlyCollaboratorsAreAssigned' };

// Contract of the routes that create and configure a site (O.1), admin only:
//   POST  /api/v1/sites            create a site of the farm of the session (201, no body)
//   PATCH /api/v1/sites/:siteId    change its name, its default voice or its strict mode (204)
// A refusal answers with its kind in the body: 400 (`InvalidName`, `InvalidTimeZone`, or a body
// that is not exactly these fields), 409 (`SiteAlreadyExists`), 404 (a site of another farm).

/** Body of POST /api/v1/sites: the identifier is made by the caller; the farm comes from the session. */
export interface CreateSiteRequest {
  readonly id: string;
  readonly name: string;
  /** IANA name, `Africa/Dakar`: it says which business day every instant of the journal falls on. */
  readonly timeZone: string;
  /** The voice of an account that chose none (E.9). */
  readonly audioLanguage?: AudioLanguage;
}

/**
 * Body of PATCH /api/v1/sites/:siteId: at least one of these fields. The time zone never changes:
 * the business days of the journal already written depend on it. A `null` voice: follow each person.
 */
export interface ConfigureSiteRequest {
  readonly name?: string;
  readonly audioLanguage?: AudioLanguage | null;
  /** Only the primary caretaker declares: the admin's choice, off by default. */
  readonly strictMode?: boolean;
}

export type SiteConfigRefusal =
  | { readonly kind: 'InvalidRequest' }
  | { readonly kind: 'InvalidName' }
  | { readonly kind: 'InvalidTimeZone' }
  | { readonly kind: 'SiteAlreadyExists' }
  | { readonly kind: 'SiteNotFound' };
