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
  /** Whole grams, typed as read: the scale is not modelled. */
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

/** Body of POST /api/v1/journal/events: exactly this field, at most 100 events. */
export interface JournalBatchRequest {
  readonly events: readonly JournalEventPayload[];
}

/** Why an event was refused: a kind from a closed list, with what explains it (`field`, `value`…). */
export type JournalRefusal = { readonly kind: string } & Readonly<Record<string, unknown>>;

/** The fate of an event, at its position in the batch as sent. `id` is absent when it could not be read. */
export type JournalEventOutcome =
  | { readonly index: number; readonly id: string; readonly status: 'Accepted' | 'Duplicate' }
  | { readonly index: number; readonly id?: string; readonly status: 'Refused'; readonly refusal: JournalRefusal };

/** Answer of POST /api/v1/journal/events: the fate of every event of the batch, in the order sent. */
export interface JournalBatchResponse {
  readonly outcomes: readonly JournalEventOutcome[];
}
