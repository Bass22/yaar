/**
 * Closed list of the reasons a field rule refuses an input. A refusal is a value
 * (`Result<T, Refusal>`), never an exception, and carries what is needed to explain it.
 * The list grows with the rules: a slice adds its reasons together with their tests.
 */
export type Refusal = {
  /** The value is not a canonical UUID: lowercase hexadecimal, 8-4-4-4-12. */
  readonly kind: 'InvalidId';
  readonly expected: IdName;
};

export type RefusalKind = Refusal['kind'];

export type IdName = 'SiteId' | 'CampaignId';
