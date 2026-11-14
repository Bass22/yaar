import { err, ok, type Brand, type Result } from '@kit';
import type { IdName, Refusal } from './refusal';

/**
 * Typed identifiers: two keys are never confused at compile time. The value is a UUID
 * supplied by the caller (the phone creates it offline); the domain checks it and never
 * generates one. Only the canonical lowercase form is accepted, so that one identifier
 * has one spelling and ingestion stays idempotent by UUID. New identifiers are added as
 * rules need them.
 */
export type JournalEventId = Brand<string, 'JournalEventId'>;
export type TenantId = Brand<string, 'TenantId'>;
export type SiteId = Brand<string, 'SiteId'>;
export type CampaignId = Brand<string, 'CampaignId'>;
/** A person with an account: the author of an event. */
export type UserId = Brand<string, 'UserId'>;
export type OrderLineId = Brand<string, 'OrderLineId'>;
export type WeighingRequestId = Brand<string, 'WeighingRequestId'>;
export type TaskId = Brand<string, 'TaskId'>;

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A UUID as the caller made it, in lowercase (rule 2): the one spelling an identifier has. */
export const isCanonicalUuid = (raw: unknown): raw is string => typeof raw === 'string' && CANONICAL_UUID.test(raw);

const uuidAs =
  <Id extends Brand<string, IdName>>(expected: IdName) =>
  (raw: unknown): Result<Id, Refusal> =>
    isCanonicalUuid(raw) ? ok(raw as Id) : err({ kind: 'InvalidId', expected });

export const JournalEventId = uuidAs<JournalEventId>('JournalEventId');
export const TenantId = uuidAs<TenantId>('TenantId');
export const SiteId = uuidAs<SiteId>('SiteId');
export const CampaignId = uuidAs<CampaignId>('CampaignId');
export const UserId = uuidAs<UserId>('UserId');
export const OrderLineId = uuidAs<OrderLineId>('OrderLineId');
export const WeighingRequestId = uuidAs<WeighingRequestId>('WeighingRequestId');
export const TaskId = uuidAs<TaskId>('TaskId');
