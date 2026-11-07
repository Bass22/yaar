-- Yaar — the whole schema, in one migration: nothing had been deployed when the schema was
-- settled (decision of 2026-11-07), so the migrations written slice by slice (D.1 to D.4) were
-- folded into this one. From the first deployment on, a change is a new migration.
--
-- Three parts: the tables, generated from the Prisma schema; then everything Prisma cannot
-- describe, written by hand — a partial index, roles, privileges and row-level security, and
-- the constraints and triggers that keep the journal append-only.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('admin', 'collaborator');

-- CreateEnum
CREATE TYPE "journal_event_type" AS ENUM ('Death', 'BagOpened', 'NoLoss', 'Loss', 'Delivery', 'Weighing', 'TaskDone', 'VoiceMessage', 'Photo');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "user_role" NOT NULL,
    "pin_hash" TEXT NOT NULL,
    "pin_failures" INTEGER NOT NULL DEFAULT 0,
    "pin_last_failure_at" TIMESTAMPTZ(3),
    "blocked_at" TIMESTAMPTZ(3),
    "sessions_valid_from" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sites" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "time_zone" TEXT NOT NULL,
    "strict_mode" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_assignments" (
    "tenant_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "is_primary" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_assignments_pkey" PRIMARY KEY ("site_id","user_id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "placement_day" DATE NOT NULL,
    "closed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

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

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_id_key" ON "users"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "sites_tenant_id_id_key" ON "sites"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "site_assignments_tenant_id_user_id_idx" ON "site_assignments"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "campaigns_tenant_id_site_id_idx" ON "campaigns"("tenant_id", "site_id");

-- CreateIndex
CREATE UNIQUE INDEX "campaigns_tenant_id_id_key" ON "campaigns"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "site_assignments" ADD CONSTRAINT "site_assignments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "site_assignments" ADD CONSTRAINT "site_assignments_tenant_id_site_id_fkey" FOREIGN KEY ("tenant_id", "site_id") REFERENCES "sites"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "site_assignments" ADD CONSTRAINT "site_assignments_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_tenant_id_site_id_fkey" FOREIGN KEY ("tenant_id", "site_id") REFERENCES "sites"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

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

-- Written by hand: Prisma cannot describe a partial index.
-- A site has at most one primary caretaker; its substitutes are as many as needed.
CREATE UNIQUE INDEX "site_assignments_one_primary_per_site" ON "site_assignments"("site_id") WHERE "is_primary";

-- Row-level security: the database itself keeps one farm out of another (CLAUDE.md §4 rule 5).
-- Written by hand — Prisma describes neither roles nor policies. Adapted from build-track
-- (0002_row_level_security).
--
-- The API connects as `yaar_app`, a role that owns nothing, is neither superuser nor
-- BYPASSRLS, and is therefore always subject to the policies below. The current tenant is a
-- transaction-local setting, `app.tenant_id`, set by the API from the session. Read with
-- `missing_ok`, an absent setting is NULL and every policy then matches no row: a query that
-- forgot its tenant sees nothing and writes nothing, instead of seeing everything.
--
-- Migrations and provisioning run as the owner of the database, never as `yaar_app`.

-- The role is shared by the whole cluster; its password and LOGIN are set out of band, at
-- deployment. It may exist already (`duplicate_object`), or be created at this very moment by
-- a migration running on another database of the cluster (`unique_violation`): both are fine.
DO $$
BEGIN
  CREATE ROLE yaar_app NOLOGIN;
EXCEPTION WHEN duplicate_object OR unique_violation THEN
  NULL;
END
$$;

-- Least privilege, table by table. No GRANT ON ALL TABLES and no default privileges: a table
-- added later is closed until its migration opens it. No DELETE (nothing is erased here) and
-- no TRUNCATE (it bypasses RLS).
GRANT USAGE ON SCHEMA public TO yaar_app;
-- A farm reads its own row; farms are created by provisioning, as the owner.
GRANT SELECT ON "tenants" TO yaar_app;
GRANT SELECT, INSERT, UPDATE ON "users" TO yaar_app;
GRANT SELECT, INSERT, UPDATE ON "sites" TO yaar_app;
GRANT SELECT, INSERT, UPDATE ON "site_assignments" TO yaar_app;
GRANT SELECT, INSERT, UPDATE ON "campaigns" TO yaar_app;
-- The application reads the journal and adds to it. Nothing else: no UPDATE, no DELETE.
GRANT SELECT, INSERT ON "journal_events" TO yaar_app;

-- FORCE: the policies bind the owner of the tables too. Only a superuser or a BYPASSRLS role
-- escapes them, and the API refuses to report ready under such a role.

-- tenants: the root. A farm only ever sees its own row — its id is the tenant.
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tenants"
  USING ("id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "users"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
-- Signing in happens before any tenant is known: the transaction names the phone number it
-- is signing in, and sees that one row — nothing else, and nothing without it (policies add
-- up, so the tenant policy keeps applying everywhere else). Reads only: the counters are
-- written later, under the tenant of the user found.
CREATE POLICY sign_in_lookup ON "users" FOR SELECT
  USING ("phone" = NULLIF(current_setting('app.sign_in_phone', true), ''));

ALTER TABLE "sites" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sites" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sites"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "site_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "site_assignments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "site_assignments"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "campaigns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "campaigns" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "campaigns"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

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
