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

/**
 * Answer of GET /api/v1/caretaker/context: what the caretaker's notebook shows, for every site
 * the session reaches. Its own type, never shared with the admin's: it carries no amount, no
 * price, no balance (CLAUDE.md §4 rule 4).
 */
export interface CaretakerContext {
  readonly sites: readonly CaretakerSite[];
}

export interface CaretakerSite {
  readonly siteId: string;
  readonly name: string;
  /** IANA time zone (`Africa/Dakar`): the phone tells today, yesterday and day J from it, offline too. */
  readonly timeZone: string;
  /** The business day it is now on the site, `YYYY-MM-DD`, in its time zone. */
  readonly today: string;
  /** The account that keeps the notebook of the site, `null` while it has none (E.7). */
  readonly primaryCaretakerId: string | null;
  /**
   * The campaigns running on the site, earliest placed first: a site may run several at once,
   * and the caretaker declares on each (decision of 2026-11-07). Empty: none running — said,
   * never shown as zeros.
   */
  readonly campaigns: readonly CaretakerCampaign[];
}

export interface CaretakerCampaign {
  readonly campaignId: string;
  readonly placementDay: string;
  /** Day J: the day of placement is day 0. */
  readonly campaignDay: number;
  /** Birds alive; `null` while unknown (the order lines that deliver the chicks are not known yet). */
  readonly liveCount: number | null;
  /** Today, yesterday and the day before, in writing order. Losses that are not deaths are not shown. */
  readonly journal: readonly CaretakerJournalLine[];
}

export interface CaretakerJournalLine {
  readonly id: string;
  readonly businessDate: string;
  readonly recordedAt: string;
  readonly author: { readonly id: string; readonly name: string };
  /** The fact that counts: the latest correction's, or the declared one. For a retracted line, the declared one. */
  readonly fact: FactPayload;
  readonly corrected: boolean;
  /** Taken back by the admin: shown, never counted nor recalled. */
  readonly retracted: boolean;
}
