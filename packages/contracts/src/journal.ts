// What a phone sends for one event of the journal (Architecture §5). Types only: the domain
// decodes it (`decodeJournalEvent` in @domain/journal) and refuses any other field. The author,
// the farm and the device are not here: they come from the session.

/** A UUID made on the phone, lowercase. */
type Uuid = string;

/** The fact observed, without its envelope. Facts only: never an average, never an amount. */
export type FactPayload =
  | { readonly type: 'Death' | 'BagOpened'; readonly quantity: number }
  | { readonly type: 'NoLoss' }
  | { readonly type: 'Loss'; readonly lossType: 'Missing' | 'Donation'; readonly quantity: number }
  | {
      readonly type: 'Delivery';
      readonly orderLineId: Uuid;
      readonly receivedQuantity: number;
      readonly deliveryNote: { readonly kind: 'Photographed'; readonly media: string } | { readonly kind: 'NoPaper' };
    }
  /** Whole grams, as read on the scale of the site. */
  | { readonly type: 'Weighing'; readonly weighingRequestId: Uuid; readonly weights: readonly number[] }
  | { readonly type: 'TaskDone'; readonly taskId: Uuid }
  /** `media`: the SHA-256 fingerprint of the file, 64 lowercase hexadecimal characters. */
  | { readonly type: 'VoiceMessage' | 'Photo'; readonly media: string };

type EnvelopePayload = {
  readonly id: Uuid;
  readonly siteId: Uuid;
  readonly campaignId: Uuid;
  /** `YYYY-MM-DD`: the day the fact belongs to, chosen by the author. */
  readonly businessDate: string;
  /** Read on the phone's clock when written, UTC to the millisecond: `2026-11-05T18:30:00.000Z`. */
  readonly recordedAt: string;
};

/** A declaration, a counter-declaration (`corrects`, with the fact that replaces) or a retraction (`retracts`, no fact). */
export type JournalEventPayload =
  | (EnvelopePayload & { readonly fact: FactPayload })
  | (EnvelopePayload & { readonly corrects: Uuid; readonly fact: FactPayload })
  | (EnvelopePayload & { readonly retracts: Uuid });
