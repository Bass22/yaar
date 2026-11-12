import { err, ok, type Result } from '@kit';
import {
  BusinessDay,
  CampaignId,
  CounterDeclaration,
  Declaration,
  Instant,
  JournalEventId,
  LOSS_TYPES,
  MediaFingerprint,
  OrderLineId,
  Quantity,
  Retraction,
  SiteId,
  TaskId,
  TenantId,
  UserId,
  WeighingRequestId,
  Weight,
  type DeliveryNote,
  type EventEnvelope,
  type Fact,
  type JournalEvent,
  type LossType,
  type Refusal,
} from '@domain/journal';

// Translation at the border of the API: what a phone sent becomes an event of the journal.
// Not a rule of the trade — nobody in the field "decodes" — so it lives here, next to the
// ingestion, and not in the domain; the domain gives it its closed list of facts and the
// constructors of every value. It moves to the domain the day the phone needs it too (F.3).

/**
 * Why a body is not an event, on top of the refusals of the values it holds. `field` names
 * the field (`fact.quantity`); it is empty when the event itself is not an object.
 */
export type DecodingRefusal =
  | Refusal
  /** A field is missing, holds the wrong kind of JSON value, or a closed list does not know it. */
  | { readonly kind: 'MalformedEvent'; readonly field: string }
  /** A field the event does not have — the author, the farm and the device come from the session. */
  | { readonly kind: 'UnknownField'; readonly field: string }
  /** A type of fact outside the closed list. */
  | { readonly kind: 'UnknownEventType' };

/** What the server knows of the caller, from the session alone. */
export type DecodingContext = {
  readonly tenantId: TenantId;
  readonly authorId: UserId;
};

type Json = Readonly<Record<string, unknown>>;

const ENVELOPE = ['id', 'siteId', 'campaignId', 'businessDate', 'recordedAt'] as const;

/**
 * Turns what a phone sent (the wire shape is `JournalEventPayload` in packages/contracts) into
 * an event of the journal, or says why not. Strict at the border (CLAUDE.md §4 rule 6): a field
 * the event does not have is refused, never ignored — the author, the farm and the device come
 * from the session, so a body that names them is refused rather than half-believed. Values go
 * through the same constructors as everywhere else; nothing is computed.
 */
export const decodeJournalEvent = (raw: unknown, context: DecodingContext): Result<JournalEvent, DecodingRefusal> => {
  if (!isObject(raw)) {
    return malformed('');
  }
  const naming = 'retracts' in raw ? 'retracts' : 'corrects' in raw ? 'corrects' : null;
  const allowed = naming === 'retracts' ? [...ENVELOPE, 'retracts'] : naming === 'corrects' ? [...ENVELOPE, 'corrects', 'fact'] : [...ENVELOPE, 'fact'];
  const unknown = unknownField(raw, allowed, '');
  if (unknown !== null) {
    return unknown;
  }
  const missing = allowed.find((field) => raw[field] === undefined);
  if (missing !== undefined) {
    return malformed(missing);
  }

  const envelope = envelopeOf(raw, context);
  if (!envelope.ok) {
    return envelope;
  }
  if (naming === 'retracts') {
    const retracts = JournalEventId(raw['retracts']);
    return retracts.ok ? ok(Retraction(envelope.value, retracts.value)) : retracts;
  }
  const fact = factOf(raw['fact']);
  if (!fact.ok) {
    return fact;
  }
  if (naming === 'corrects') {
    const corrects = JournalEventId(raw['corrects']);
    return corrects.ok ? ok(CounterDeclaration(envelope.value, corrects.value, fact.value)) : corrects;
  }
  return ok(Declaration(envelope.value, fact.value));
};

function envelopeOf(raw: Json, { tenantId, authorId }: DecodingContext): Result<EventEnvelope, DecodingRefusal> {
  const id = JournalEventId(raw['id']);
  if (!id.ok) return id;
  const siteId = SiteId(raw['siteId']);
  if (!siteId.ok) return siteId;
  const campaignId = CampaignId(raw['campaignId']);
  if (!campaignId.ok) return campaignId;
  const businessDate = BusinessDay(raw['businessDate']);
  if (!businessDate.ok) return businessDate;
  const recordedAt = Instant(raw['recordedAt']);
  if (!recordedAt.ok) return recordedAt;
  return ok({ id: id.value, tenantId, siteId: siteId.value, campaignId: campaignId.value, authorId, businessDate: businessDate.value, recordedAt: recordedAt.value });
}

function factOf(raw: unknown): Result<Fact, DecodingRefusal> {
  if (!isObject(raw)) {
    return malformed('fact');
  }
  const type = raw['type'];
  const fields = typeof type === 'string' ? FIELDS[type as Fact['type']] : undefined;
  if (fields === undefined || !Object.hasOwn(FIELDS, type as string)) {
    return err({ kind: 'UnknownEventType' });
  }
  const unknown = unknownField(raw, ['type', ...fields, ...(OPTIONAL_FIELDS[type as Fact['type']] ?? [])], 'fact.');
  if (unknown !== null) {
    return unknown;
  }
  const missing = fields.find((field) => raw[field] === undefined);
  if (missing !== undefined) {
    return malformed(`fact.${missing}`);
  }

  switch (type as Fact['type']) {
    case 'Death': {
      const quantity = quantityOf(raw, 'quantity');
      if (!quantity.ok) return quantity;
      if (raw['deathEvidence'] === undefined) return ok({ type: 'Death', quantity: quantity.value });
      // Added by K.6: photographed with its fingerprint, or no photo — nothing else.
      const evidence = raw['deathEvidence'];
      if (isObject(evidence) && evidence['kind'] === 'NoPhoto' && unknownField(evidence, ['kind'], 'fact.deathEvidence.') === null) {
        return ok({ type: 'Death', quantity: quantity.value, deathEvidence: { kind: 'NoPhoto' } });
      }
      if (isObject(evidence) && evidence['kind'] === 'Photographed' && unknownField(evidence, ['kind', 'media'], 'fact.deathEvidence.') === null) {
        const media = MediaFingerprint(evidence['media']);
        return media.ok ? ok({ type: 'Death', quantity: quantity.value, deathEvidence: { kind: 'Photographed', media: media.value } }) : malformed('fact.deathEvidence.media');
      }
      return malformed('fact.deathEvidence');
    }
    case 'BagOpened': {
      const quantity = quantityOf(raw, 'quantity');
      return quantity.ok ? ok({ type: 'BagOpened', quantity: quantity.value }) : quantity;
    }
    case 'NoLoss':
      return ok({ type: 'NoLoss' });
    case 'Loss': {
      const lossType = raw['lossType'];
      if (!isLossType(lossType)) {
        return malformed('fact.lossType');
      }
      const quantity = quantityOf(raw, 'quantity');
      return quantity.ok ? ok({ type: 'Loss', lossType, quantity: quantity.value }) : quantity;
    }
    case 'Delivery': {
      const orderLineId = OrderLineId(raw['orderLineId']);
      if (!orderLineId.ok) return orderLineId;
      const receivedQuantity = quantityOf(raw, 'receivedQuantity');
      if (!receivedQuantity.ok) return receivedQuantity;
      const deliveryNote = deliveryNoteOf(raw['deliveryNote']);
      if (!deliveryNote.ok) return deliveryNote;
      return ok({ type: 'Delivery', orderLineId: orderLineId.value, receivedQuantity: receivedQuantity.value, deliveryNote: deliveryNote.value });
    }
    case 'Weighing': {
      const weighingRequestId = WeighingRequestId(raw['weighingRequestId']);
      if (!weighingRequestId.ok) return weighingRequestId;
      const grams = raw['weights'];
      if (!Array.isArray(grams) || grams.length === 0 || grams.some((value) => typeof value !== 'number')) {
        return malformed('fact.weights');
      }
      const weights: Weight[] = [];
      for (const value of grams as number[]) {
        const weight = Weight(value);
        if (!weight.ok) return weight;
        weights.push(weight.value);
      }
      if (raw['photos'] === undefined) return ok({ type: 'Weighing', weighingRequestId: weighingRequestId.value, weights });
      // Added by T.6: absent, or a list of fingerprints — never empty, never anything else.
      const shot = raw['photos'];
      if (!Array.isArray(shot) || shot.length === 0) return malformed('fact.photos');
      const photos: MediaFingerprint[] = [];
      for (const value of shot as unknown[]) {
        const photo = MediaFingerprint(value);
        if (!photo.ok) return photo;
        photos.push(photo.value);
      }
      return ok({ type: 'Weighing', weighingRequestId: weighingRequestId.value, weights, photos });
    }
    case 'WeighingValidated': {
      const weighingId = JournalEventId(raw['weighingId']);
      return weighingId.ok ? ok({ type: 'WeighingValidated', weighingId: weighingId.value }) : weighingId;
    }
    case 'TaskDone': {
      const taskId = TaskId(raw['taskId']);
      return taskId.ok ? ok({ type: 'TaskDone', taskId: taskId.value }) : taskId;
    }
    case 'VoiceMessage':
    case 'Photo': {
      const media = MediaFingerprint(raw['media']);
      return media.ok ? ok({ type: type as 'VoiceMessage' | 'Photo', media: media.value }) : media;
    }
  }
}

// Fields a type may carry or leave out, added after its first version (CLAUDE.md §4 rule 1: the
// schema only grows by optional fields).
const OPTIONAL_FIELDS: { readonly [Type in Fact['type']]?: readonly string[] } = {
  Weighing: ['photos'],
  Death: ['deathEvidence'],
};

// The fields of each type of fact, besides `type`. Closed: a type absent here is unknown.
const FIELDS: { readonly [Type in Fact['type']]: readonly string[] } = {
  Death: ['quantity'],
  BagOpened: ['quantity'],
  NoLoss: [],
  Loss: ['lossType', 'quantity'],
  Delivery: ['orderLineId', 'receivedQuantity', 'deliveryNote'],
  Weighing: ['weighingRequestId', 'weights'],
  WeighingValidated: ['weighingId'],
  TaskDone: ['taskId'],
  VoiceMessage: ['media'],
  Photo: ['media'],
};

function deliveryNoteOf(raw: unknown): Result<DeliveryNote, DecodingRefusal> {
  if (!isObject(raw)) {
    return malformed('fact.deliveryNote');
  }
  switch (raw['kind']) {
    case 'Photographed': {
      const unknown = unknownField(raw, ['kind', 'media'], 'fact.deliveryNote.');
      if (unknown !== null) return unknown;
      if (raw['media'] === undefined) return malformed('fact.deliveryNote.media');
      const media = MediaFingerprint(raw['media']);
      return media.ok ? ok({ kind: 'Photographed', media: media.value }) : media;
    }
    case 'NoPaper': {
      const unknown = unknownField(raw, ['kind'], 'fact.deliveryNote.');
      return unknown ?? ok({ kind: 'NoPaper' });
    }
    default:
      return malformed('fact.deliveryNote.kind');
  }
}

function quantityOf(raw: Json, field: string): Result<Quantity, DecodingRefusal> {
  const value = raw[field];
  return typeof value === 'number' ? Quantity(value) : malformed(`fact.${field}`);
}

function unknownField(raw: Json, allowed: readonly string[], prefix: string): Result<never, DecodingRefusal> | null {
  const field = Object.keys(raw).find((key) => !allowed.includes(key));
  return field === undefined ? null : err({ kind: 'UnknownField', field: `${prefix}${field}` });
}

function malformed(field: string): Result<never, DecodingRefusal> {
  return err({ kind: 'MalformedEvent', field });
}

function isLossType(raw: unknown): raw is LossType {
  return (LOSS_TYPES as readonly unknown[]).includes(raw);
}

function isObject(raw: unknown): raw is Json {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}
