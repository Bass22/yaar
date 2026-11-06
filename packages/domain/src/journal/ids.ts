import { err, ok, type Brand, type Result } from '@kit';
import type { IdName, Refusal } from './refusal';

/**
 * Typed identifiers: two keys are never confused at compile time. The value is a UUID
 * supplied by the caller (the phone creates it offline); the domain checks it and never
 * generates one. Only the canonical lowercase form is accepted, so that one identifier
 * has one spelling and ingestion stays idempotent by UUID. New identifiers are added as
 * rules need them.
 */
export type SiteId = Brand<string, 'SiteId'>;
export type CampaignId = Brand<string, 'CampaignId'>;

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const uuidAs =
  <Id extends Brand<string, IdName>>(expected: IdName) =>
  (raw: unknown): Result<Id, Refusal> =>
    typeof raw === 'string' && CANONICAL_UUID.test(raw) ? ok(raw as Id) : err({ kind: 'InvalidId', expected });

export const SiteId = uuidAs<SiteId>('SiteId');
export const CampaignId = uuidAs<CampaignId>('CampaignId');
