/**
 * Closed list of the reasons a field rule refuses an input. A refusal is a value
 * (`Result<T, Refusal>`), never an exception, and carries what is needed to explain it.
 * The list grows with the rules: a slice adds its reasons together with their tests.
 */
export type Refusal =
  /** The value is not a canonical UUID: lowercase hexadecimal, 8-4-4-4-12. */
  | { readonly kind: 'InvalidId'; readonly expected: IdName }
  /** A declared quantity is a strictly positive integer; zero has its own event. */
  | { readonly kind: 'InvalidQuantity'; readonly value: number }
  /** A weight is a positive whole number of grams. */
  | { readonly kind: 'InvalidWeight'; readonly grams: number }
  /** The weight is beyond what the scale of the site can read. */
  | { readonly kind: 'WeightOutOfScale'; readonly grams: number; readonly capacityGrams: number }
  /** Not a real calendar date written `YYYY-MM-DD`. */
  | { readonly kind: 'InvalidBusinessDay' }
  /** Not a time zone the platform knows (IANA name such as `Africa/Dakar`). */
  | { readonly kind: 'InvalidTimeZone' }
  /** Not a point in time written in UTC to the millisecond (`2026-11-05T18:30:00.000Z`). */
  | { readonly kind: 'InvalidInstant' }
  /** Not a SHA-256 fingerprint: 64 lowercase hexadecimal characters. */
  | { readonly kind: 'InvalidMediaFingerprint' }
  /** The declaration names a site that is not the one of its campaign. */
  | { readonly kind: 'SiteNotOfCampaign' }
  /** The declaration was written once the campaign was closed. */
  | { readonly kind: 'CampaignClosed' }
  /** The business date is after the day the declaration was written, in the time zone of the site. */
  | { readonly kind: 'FutureBusinessDate' }
  /** The business date is before the chicks were placed. */
  | { readonly kind: 'BusinessDateBeforePlacement' }
  /** Older than the day before yesterday: only the admin still declares for that day. */
  | { readonly kind: 'CatchUpWindowPassed' }
  /** The author is neither an admin nor a caretaker: that role never declares. */
  | { readonly kind: 'RoleCannotDeclare' }
  /** The author is neither the primary caretaker of the site nor one of its substitutes. */
  | { readonly kind: 'NotAssignedToSite' }
  /** The admin turned strict mode on for the site: only its primary caretaker declares. */
  | { readonly kind: 'StrictModePrimaryOnly' }
  /** A caretaker declares deaths; a loss that is not a death (missing, given away) is declared by the admin. */
  | { readonly kind: 'LossByAdminOnly' }
  /** "Nothing lost" was written for a day on which deaths were already written. */
  | { readonly kind: 'NoLossAfterDeaths' }
  /** Only the admin takes a declaration back. */
  | { readonly kind: 'RetractionByAdminOnly' }
  /** The declaration was taken back for good: it is neither corrected nor taken back again. */
  | { readonly kind: 'DeclarationRetracted' }
  /** A counter-declaration or a retraction names the declaration itself, never a counter-declaration or a retraction. */
  | { readonly kind: 'CorrectsACounterDeclaration' }
  /** The corrected or retracted event belongs to another tenant, site or campaign. */
  | { readonly kind: 'CorrectsEventElsewhere' }
  /** A counter-declaration or a retraction keeps the business date of the declaration it names. */
  | { readonly kind: 'CorrectionChangesBusinessDate' }
  /** A counter-declaration keeps the type of the declaration it corrects. */
  | { readonly kind: 'CorrectionChangesType' }
  /** A counter-declaration keeps what the declaration is about: order line, weighing request, task, media. */
  | { readonly kind: 'CorrectionChangesReference' }
  /** A counter-declaration or a retraction has its own identifier: under the one of its declaration it would be dropped as a duplicate. */
  | { readonly kind: 'CorrectsItself' };

export type RefusalKind = Refusal['kind'];

export type IdName =
  | 'JournalEventId'
  | 'TenantId'
  | 'SiteId'
  | 'CampaignId'
  | 'UserId'
  | 'OrderLineId'
  | 'WeighingRequestId'
  | 'TaskId';
