import type { BusinessDay } from './business-day';
import type {
  CampaignId,
  JournalEventId,
  OrderLineId,
  SiteId,
  TaskId,
  TenantId,
  UserId,
  WeighingRequestId,
} from './ids';
import type { Instant } from './instant';
import type { MediaFingerprint } from './media-fingerprint';
import type { Quantity } from './quantity';
import type { Weight } from './weight';

/** Who declared, where, for which day, and when it was written down. */
export type EventEnvelope = {
  /** Created on the phone: ingestion is idempotent on it. */
  readonly id: JournalEventId;
  readonly tenantId: TenantId;
  readonly siteId: SiteId;
  readonly campaignId: CampaignId;
  readonly authorId: UserId;
  /** The day the fact belongs to, chosen by the author. */
  readonly businessDate: BusinessDay;
  /** When the fact was written down, read on the clock by the caller. */
  readonly recordedAt: Instant;
};

/** Whether the caretaker showed the dead (K.6): photographed, with the photo's fingerprint, or no photo — an answer, never an oversight. */
export type DeathEvidence = { readonly kind: 'Photographed'; readonly media: MediaFingerprint } | { readonly kind: 'NoPhoto' };

/** The paper handed over by the driver: photographed, or declared missing. */
export type DeliveryNote =
  | { readonly kind: 'Photographed'; readonly media: MediaFingerprint }
  | { readonly kind: 'NoPaper' };

/**
 * A loss that is not a death: animals found missing at a recount, given away, or stolen. With
 * deaths, the publisher's base of loss types (N.1). Grows by addition only.
 */
export const LOSS_TYPES = Object.freeze(['Missing', 'Donation', 'Theft'] as const);
export type LossType = (typeof LOSS_TYPES)[number];

/**
 * What was observed in the field. Closed list, and facts only: nothing here is computed (no
 * average, no variance, no live count) and nothing is an amount of money — events ship to the
 * caretaker phone. The list changes by addition only: a field keeps its meaning forever.
 */
export type Fact =
  | {
      readonly type: 'Death';
      readonly quantity: Quantity;
      /** The caretaker's answer, photo or not (K.6, added): absent when it was never asked — not « no photo ». */
      readonly deathEvidence?: DeathEvidence;
    }
  | { readonly type: 'BagOpened'; readonly quantity: Quantity }
  /** The explicit zero: nothing was lost that day. */
  | { readonly type: 'NoLoss' }
  /** Lowers the live count without counting as mortality. Declared by the admin only. */
  | { readonly type: 'Loss'; readonly lossType: LossType; readonly quantity: Quantity }
  | {
      readonly type: 'Delivery';
      readonly orderLineId: OrderLineId;
      readonly receivedQuantity: Quantity;
      readonly deliveryNote: DeliveryNote;
    }
  | {
      readonly type: 'Weighing';
      readonly weighingRequestId: WeighingRequestId;
      readonly weights: readonly Weight[];
      /** The photo of the scale for each weight, in the same order (T.6, added): absent, never empty. */
      readonly photos?: readonly MediaFingerprint[];
    }
  /** The admin validated a weighing (T.5): it joins the real curve. Admin only, final. */
  | { readonly type: 'WeighingValidated'; readonly weighingId: JournalEventId }
  | { readonly type: 'TaskDone'; readonly taskId: TaskId }
  | { readonly type: 'VoiceMessage'; readonly media: MediaFingerprint }
  | { readonly type: 'Photo'; readonly media: MediaFingerprint };

export type EventType = Fact['type'];

/** A signed, immutable fact of the journal, as its author declared it. */
export type Declaration = EventEnvelope & Fact;

/**
 * Builds a declaration from verified parts. Only the fields of the schema are copied and the result
 * is frozen in depth: whatever else the caller passed, or changes afterwards, never reaches the
 * journal. An unknown type can only come from bypassed typing: it is a fault and throws.
 */
export const Declaration = (envelope: EventEnvelope, fact: Fact): Declaration =>
  Object.freeze({ ...envelopeOf(envelope), ...factOf(fact) });

/**
 * A correction made after sending: a new signed event that names the declaration it corrects
 * and carries the fact that replaces the declared one. The declaration itself is never touched.
 */
export type CounterDeclaration = EventEnvelope & { readonly corrects: JournalEventId } & Fact;

/** Builds a counter-declaration the way a declaration is built: schema fields only, frozen. */
export const CounterDeclaration = (envelope: EventEnvelope, corrects: JournalEventId, fact: Fact): CounterDeclaration =>
  Object.freeze({ ...envelopeOf(envelope), corrects, ...factOf(fact) });

/**
 * Takes a declaration made by mistake back: a signed event that names it and carries no fact.
 * The declaration stays in the journal and no longer counts, whatever corrects it.
 */
export type Retraction = EventEnvelope & { readonly retracts: JournalEventId };

/** Builds a retraction the way a declaration is built: schema fields only, frozen. */
export const Retraction = (envelope: EventEnvelope, retracts: JournalEventId): Retraction =>
  Object.freeze({ ...envelopeOf(envelope), retracts });

/** Everything the journal holds. */
export type JournalEvent = Declaration | CounterDeclaration | Retraction;

export const isCounterDeclaration = (event: JournalEvent): event is CounterDeclaration => 'corrects' in event;

export const isRetraction = (event: JournalEvent): event is Retraction => 'retracts' in event;

function envelopeOf(envelope: EventEnvelope): EventEnvelope {
  return {
    id: envelope.id,
    tenantId: envelope.tenantId,
    siteId: envelope.siteId,
    campaignId: envelope.campaignId,
    authorId: envelope.authorId,
    businessDate: envelope.businessDate,
    recordedAt: envelope.recordedAt,
  };
}

/** The fact alone, without the envelope that may come with it. */
export function factOf(fact: Fact): Fact {
  switch (fact.type) {
    case 'Death':
      return { type: fact.type, quantity: fact.quantity, ...(fact.deathEvidence === undefined ? {} : { deathEvidence: deathEvidenceOf(fact.deathEvidence) }) };
    case 'BagOpened':
      return { type: fact.type, quantity: fact.quantity };
    case 'NoLoss':
      return { type: fact.type };
    case 'Loss':
      return { type: fact.type, lossType: lossTypeOf(fact.lossType), quantity: fact.quantity };
    case 'Delivery':
      return {
        type: fact.type,
        orderLineId: fact.orderLineId,
        receivedQuantity: fact.receivedQuantity,
        deliveryNote: deliveryNoteOf(fact.deliveryNote),
      };
    case 'Weighing':
      return {
        type: fact.type,
        weighingRequestId: fact.weighingRequestId,
        weights: Object.freeze([...fact.weights]),
        ...(fact.photos === undefined ? {} : { photos: Object.freeze([...fact.photos]) }),
      };
    case 'WeighingValidated':
      return { type: fact.type, weighingId: fact.weighingId };
    case 'TaskDone':
      return { type: fact.type, taskId: fact.taskId };
    case 'VoiceMessage':
    case 'Photo':
      return { type: fact.type, media: fact.media };
    default:
      return outOfSchema('event type', fact);
  }
}

function lossTypeOf(lossType: LossType): LossType {
  switch (lossType) {
    case 'Missing':
    case 'Donation':
    case 'Theft':
      return lossType;
    default:
      return outOfSchema('loss type', lossType);
  }
}

function deliveryNoteOf(note: DeliveryNote): DeliveryNote {
  switch (note?.kind) {
    case 'Photographed':
      return Object.freeze({ kind: note.kind, media: note.media });
    case 'NoPaper':
      return Object.freeze({ kind: note.kind });
    default:
      return outOfSchema('delivery note', note);
  }
}

function outOfSchema(what: string, value: never): never {
  throw new TypeError(`Unknown ${what}: ${JSON.stringify(value)}`);
}

function deathEvidenceOf(evidence: DeathEvidence): DeathEvidence {
  switch (evidence.kind) {
    case 'Photographed':
      return Object.freeze({ kind: evidence.kind, media: evidence.media });
    case 'NoPhoto':
      return Object.freeze({ kind: evidence.kind });
    default:
      return outOfSchema('death evidence', evidence);
  }
}
