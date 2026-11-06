// Entry point `@domain/journal`: field rules shared by the server and the caretaker phone
// (declarations, live count, weighing average, quantity variance, duplicates).
// It never imports `../finance`: whatever is exported here ships to the phone.
export { CampaignId, SiteId } from './ids';
export type { IdName, Refusal, RefusalKind } from './refusal';
