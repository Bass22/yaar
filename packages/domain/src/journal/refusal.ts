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
  | { readonly kind: 'InvalidMediaFingerprint' };

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
