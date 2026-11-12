// What a phone sends for one event of the journal (Architecture §5). Types only: the domain
// decodes it (`decodeJournalEvent` in @domain/journal) and refuses any other field. The author,
// the farm and the device are not here: they come from the session.

/** A UUID made on the phone, lowercase. */
type Uuid = string;

/** The fact observed, without its envelope. Facts only: never an average, never an amount. */
export type FactPayload =
  | {
      readonly type: 'Death';
      readonly quantity: number;
      /** Whether the caretaker showed the dead (K.6): absent when never asked — not « no photo ». */
      readonly deathEvidence?: { readonly kind: 'Photographed'; readonly media: string } | { readonly kind: 'NoPhoto' };
    }
  | { readonly type: 'BagOpened'; readonly quantity: number }
  | { readonly type: 'NoLoss' }
  | { readonly type: 'Loss'; readonly lossType: 'Missing' | 'Donation' | 'Theft'; readonly quantity: number }
  | {
      readonly type: 'Delivery';
      readonly orderLineId: Uuid;
      readonly receivedQuantity: number;
      readonly deliveryNote: { readonly kind: 'Photographed'; readonly media: string } | { readonly kind: 'NoPaper' };
    }
  /** Whole grams, typed as read: the scale is not modelled. */
  | { readonly type: 'Weighing'; readonly weighingRequestId: Uuid; readonly weights: readonly number[]; /** One photo of the scale per weight, same order (T.6); absent when none. */ readonly photos?: readonly string[] }
  /** The admin validated a weighing (T.5). Admin only. */
  | { readonly type: 'WeighingValidated'; readonly weighingId: Uuid }
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
  /**
   * Whom « Parler » reaches on WhatsApp (M.5, decision of 2026-11-08): the earliest admin of the
   * farm who is not blocked — a name and a phone number, nothing else. `null`: no admin to reach.
   */
  readonly chef: CaretakerChef | null;
}

export interface CaretakerChef {
  readonly name: string;
  /** International form, `+221…`. */
  readonly phone: string;
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
  /** One per announced order still expected, earliest announced first (Q.6). Never a price. */
  readonly deliveries: readonly CaretakerDelivery[];
  /** The weighings the chef asked for, from their day on, until a weighing answers them (T.2). */
  readonly weighingRequests: readonly CaretakerWeighingRequest[];
  /** The strain placed (`Cobb500`): the weighing screen bounds a weight by its target (T.3). */
  readonly strain: string;
}

export interface CaretakerWeighingRequest {
  readonly weighingRequestId: string;
  /** `YYYY-MM-DD`: the day the chef asked for. */
  readonly requestedFor: string;
}

/** A delivery the caretaker waits for: an announced order, neither fully received nor closed. Quantities only (rule 4). */
export interface CaretakerDelivery {
  readonly orderId: string;
  readonly lines: readonly CaretakerDeliveryLine[];
}

export interface CaretakerDeliveryLine {
  readonly orderLineId: string;
  /** The farm's name for what comes (« Aliment démarrage »); its category gives the picture. */
  readonly name: string;
  readonly category: 'Feed' | 'Chicks' | 'Health' | 'Bedding' | 'Labour' | 'Equipment' | 'Cleaning' | 'Transport' | 'Processing' | 'Utilities' | 'FinancialCharges' | 'Other';
  readonly expected: number;
  readonly received: number;
  /** Never below zero: a bonus leaves nothing to come. */
  readonly remaining: number;
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
  /** For a delivery: what was received, by the farm's name and its category (Q.7) — never a price. */
  readonly delivery?: { readonly name: string; readonly category: CaretakerDeliveryLine['category'] };
}

/** Body of POST /api/v1/weighing-requests (T.2): the chef asks for a weighing of a flock, on a day. Admin only. */
export interface RecordWeighingRequest {
  readonly id: string;
  readonly campaignId: string;
  /** `YYYY-MM-DD`, today or later on the site. */
  readonly requestedFor: string;
}

/** A weighing declared and not validated yet, as the office corrects and validates it (T.5). */
export interface WeighingToValidate {
  /** The identifier of the weighing as declared: a correction and the validation name it. */
  readonly weighingId: string;
  /** The request it answers: a correction carries it again. */
  readonly weighingRequestId: string;
  readonly businessDate: string;
  readonly campaignDay: number;
  readonly authorName: string;
  /** As they count: the latest correction's, or the declared ones. */
  readonly weights: readonly number[];
  /** The photo of the scale for each weight, same order (T.6): what the admin reads first. `null` when none. */
  readonly photos: readonly string[] | null;
  readonly average: number;
}

/** Answer of GET /api/v1/campaigns/:id/weighings (admin): the real curve, and what waits for validation. */
export interface WeighingsView {
  readonly campaignId: string;
  /** Where the flock is: a correction and a validation are written there. */
  readonly siteId: string;
  /** The strain placed (`Cobb500`): the curve is read against its targets. */
  readonly strain: string;
  /** Asked for and not answered yet by a weighing, earliest first. */
  readonly openRequests: readonly CaretakerWeighingRequest[];
  /** Validated weighings only, earliest first. */
  readonly curve: readonly { readonly weighingId: string; readonly campaignDay: number; readonly average: number }[];
  readonly toValidate: readonly WeighingToValidate[];
}

/** Answer of GET /api/v1/campaigns/:id/death-photos (admin, K.6): for each caretaker, how its death declarations were answered. */
export interface DeathPhotosView {
  readonly campaignId: string;
  /** By name. Declarations taken back do not count. */
  readonly caretakers: readonly { readonly authorId: string; readonly name: string; readonly photographed: number; readonly noPhoto: number; readonly unanswered: number }[];
}
