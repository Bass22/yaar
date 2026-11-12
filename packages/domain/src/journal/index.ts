// Entry point `@domain/journal`: field rules shared by the server and the caretaker phone
// (declarations, live count, weighing average, quantity variance, duplicates).
// It never imports `../finance`: whatever is exported here ships to the phone.
export {
  addDays,
  BusinessDay,
  businessDayAt,
  campaignDay,
  recentBusinessDays,
  TimeZone,
  type RecentBusinessDays,
} from './business-day';
export {
  DEFAULT_PLANNED_DURATION,
  MAX_CAMPAIGN_DAYS,
  validateCampaignOpening,
  type Campaign,
  type CampaignOpening,
  type CampaignOpeningRequest,
} from './campaign';
export {
  effectiveJournal,
  validateCounterDeclaration,
  type CounterDeclarationContext,
  type JournalLine,
} from './counter-declaration';
export {
  declaredBefore,
  summarizeDay,
  validateAgainstDay,
  type DayContext,
  type DayMortality,
  type DaySummary,
  type DeclaredBefore,
  type DeclaredQuantity,
} from './day-summary';
export { lineDelivery, receivedByLine, type LineDelivery } from './delivery';
export { CHICKS_PER_BOX, deliveryCounting, receivedOf, type CountingUnit, type DeliveryCounting } from './delivery-counting';
export { validateDeliveryTarget, type DeliveryTarget } from './delivery-target';
export {
  authorizeDeclaration,
  type Author,
  type DeclarationPolicyContext,
  type SiteStaff,
} from './declaration-policy';
export {
  CampaignId,
  JournalEventId,
  OrderLineId,
  SiteId,
  TaskId,
  TenantId,
  UserId,
  WeighingRequestId,
} from './ids';
export { Instant, instantOf } from './instant';
export {
  CounterDeclaration,
  Declaration,
  factOf,
  isCounterDeclaration,
  isRetraction,
  LOSS_TYPES,
  Retraction,
  type DeliveryNote,
  type EventEnvelope,
  type EventType,
  type Fact,
  type JournalEvent,
  type LossType,
} from './journal-event';
export { computeLiveCount, type LiveCount, type LiveCountContext } from './live-count';
export { MediaFingerprint } from './media-fingerprint';
export { Quantity } from './quantity';
export type { IdName, Refusal, RefusalKind } from './refusal';
export { validateRetraction, type RetractionContext } from './retraction';
export type { Role } from './role';
export { STRAINS, targetAt, type Species, type Strain, type StrainTarget } from './strain';
export { validateDeclaration, type DeclarationContext } from './validate-declaration';
export { Weight } from './weight';
export { averageWeight, validateWeighing, validateWeighingValidation, weightBounds, weightCurve, WEIGHING_WEIGHTS, type WeighingTarget, type WeightPoint } from './weighing';
