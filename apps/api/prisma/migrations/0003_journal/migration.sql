-- CreateEnum
CREATE TYPE "journal_event_type" AS ENUM ('Death', 'BagOpened', 'NoLoss', 'Loss', 'Delivery', 'Weighing', 'TaskDone', 'VoiceMessage', 'Photo');

-- CreateTable
CREATE TABLE "journal_events" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" "journal_event_type",
    "fact" JSONB,
    "corrects" UUID,
    "retracts" UUID,

    CONSTRAINT "journal_events_pkey" PRIMARY KEY ("tenant_id","id")
);

-- AddForeignKey
ALTER TABLE "journal_events" ADD CONSTRAINT "journal_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "journal_events" ADD CONSTRAINT "journal_events_tenant_id_site_id_fkey" FOREIGN KEY ("tenant_id", "site_id") REFERENCES "sites"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "journal_events" ADD CONSTRAINT "journal_events_tenant_id_campaign_id_fkey" FOREIGN KEY ("tenant_id", "campaign_id") REFERENCES "campaigns"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "journal_events" ADD CONSTRAINT "journal_events_tenant_id_author_id_fkey" FOREIGN KEY ("tenant_id", "author_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "journal_events" ADD CONSTRAINT "journal_events_tenant_id_corrects_fkey" FOREIGN KEY ("tenant_id", "corrects") REFERENCES "journal_events"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "journal_events" ADD CONSTRAINT "journal_events_tenant_id_retracts_fkey" FOREIGN KEY ("tenant_id", "retracts") REFERENCES "journal_events"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Everything below is written by hand: Prisma describes none of it.

-- The shape of a row. A retraction names a declaration and carries no fact; any other event
-- carries its type and its fact, and may name the declaration it corrects.
ALTER TABLE "journal_events" ADD CONSTRAINT "journal_events_shape" CHECK (
  ("retracts" IS NOT NULL AND "corrects" IS NULL AND "type" IS NULL AND "fact" IS NULL)
  OR ("retracts" IS NULL AND "type" IS NOT NULL AND "fact" IS NOT NULL)
);

-- Under the identifier of the event it names, a correction would be dropped as a duplicate.
ALTER TABLE "journal_events" ADD CONSTRAINT "journal_events_names_another_event" CHECK (
  "corrects" IS DISTINCT FROM "id" AND "retracts" IS DISTINCT FROM "id"
);

-- The application reads the journal and adds to it. Nothing else: no UPDATE, no DELETE.
GRANT SELECT, INSERT ON "journal_events" TO yaar_app;

ALTER TABLE "journal_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "journal_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "journal_events"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Append-only for everyone (CLAUDE.md §4 rule 1). The missing privileges above stop the
-- application; these triggers stop the owner of the table too, and a migration written by
-- mistake. Correcting an event is adding another one, never touching this one.
CREATE FUNCTION journal_events_refuse_change() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'journal_events is append-only: % is refused', TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;

CREATE TRIGGER journal_events_no_update_no_delete
  BEFORE UPDATE OR DELETE ON "journal_events"
  FOR EACH ROW EXECUTE FUNCTION journal_events_refuse_change();

CREATE TRIGGER journal_events_no_truncate
  BEFORE TRUNCATE ON "journal_events"
  FOR EACH STATEMENT EXECUTE FUNCTION journal_events_refuse_change();

-- The reception date is the database's own clock, whatever the client sent (rule 2).
CREATE FUNCTION journal_events_stamp_reception() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  NEW."received_at" := now();
  RETURN NEW;
END
$$;

CREATE TRIGGER journal_events_received_at
  BEFORE INSERT ON "journal_events"
  FOR EACH ROW EXECUTE FUNCTION journal_events_stamp_reception();
