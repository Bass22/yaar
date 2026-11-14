/** Body of PUT /api/v1/push-subscription (Y.1): what the browser handed back once the person agreed. */
export interface SubscribeToPushRequest {
  /** The address of the browser's push service: Google, Mozilla, Apple or Microsoft only. */
  readonly endpoint: string;
  readonly keys: { readonly p256dh: string; readonly auth: string };
}

/** Answer of GET /api/v1/push/public-key: what the browser needs to subscribe. Never the private key. */
export interface PushPublicKeyView {
  readonly publicKey: string;
}

/** The kinds of notification the server sends (Y.2a, Y.3): a closed list, each with its landing on the phone (Y.4). */
export type PushKind = 'DeliveryAnnounced' | 'WeighingRequested' | 'CorrectionWritten' | 'TooManyDeaths' | 'MorningReminder';

export type PushSubscriptionRefusal = { readonly kind: 'UnknownPushService' } | { readonly kind: 'InvalidSubscription' } | { readonly kind: 'PushNotConfigured' };

/** A correction a caretaker wrote, waiting for an admin's « Vu » (Y.2b): GET /api/v1/corrections/to-review. Never an amount. */
export interface CorrectionToReview {
  readonly correctionId: string;
  readonly campaignId: string;
  readonly siteId: string;
  readonly siteName: string;
  /** `YYYY-MM-DD`: the day the declaration is for. */
  readonly businessDate: string;
  readonly campaignDay: number;
  readonly authorName: string;
  /** What counted before this correction, and what counts after it: « 3 morts », « 5 morts ». */
  readonly before: string;
  readonly after: string;
  readonly recordedAt: string;
}
