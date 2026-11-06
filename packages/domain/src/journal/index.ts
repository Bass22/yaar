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
export type { Campaign } from './campaign';
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
export { JournalEvent, type DeliveryNote, type EventEnvelope, type EventType, type Fact } from './journal-event';
export { MediaFingerprint } from './media-fingerprint';
export { Quantity } from './quantity';
export type { IdName, Refusal, RefusalKind } from './refusal';
export type { Role } from './role';
export { validateDeclaration, type DeclarationContext } from './validate-declaration';
export { Weight, type Scale } from './weight';
