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
