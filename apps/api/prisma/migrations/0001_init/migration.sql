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
CREATE TYPE "account_avatar" AS ENUM ('baobab', 'mango', 'pirogue', 'teapot', 'calabash', 'sheep', 'goat', 'watermelon', 'fish', 'star', 'turtle', 'drum');

-- CreateEnum
CREATE TYPE "audio_language" AS ENUM ('wo', 'fr');

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('admin', 'collaborator');

-- CreateEnum
CREATE TYPE "journal_event_type" AS ENUM ('Death', 'BagOpened', 'NoLoss', 'Loss', 'Delivery', 'Weighing', 'WeighingValidated', 'TaskDone', 'VoiceMessage', 'Photo');

-- CreateEnum
CREATE TYPE "audit_action" AS ENUM ('SignInSucceeded', 'SignInFailed', 'SignInRefused', 'PinChosen', 'AccountCreated', 'AccountBlocked', 'AccountUnblocked', 'SignedOutEverywhere', 'PinReset', 'SiteAssigned', 'SiteUnassigned', 'PrimaryCaretakerDesignated', 'AdminAdded', 'SiteCreated', 'SiteConfigured', 'CampaignOpened', 'CounterpartyCreated', 'CounterpartyConfigured', 'CounterpartyArchived', 'CostTypeCreated', 'CostTypeConfigured', 'CostTypeArchived', 'OrderDrafted', 'OrderRevised', 'OrderAnnounced', 'OrderClosed', 'PaymentRecorded', 'CostRecorded', 'CostRevised', 'SettlementRecorded', 'SaleRecorded', 'SaleReceiptRecorded', 'WeighingRequested', 'CampaignClosed', 'BudgetRecorded');

-- CreateEnum
CREATE TYPE "counterparty_kind" AS ENUM ('Supplier', 'Customer', 'Collaborator');

-- CreateEnum
CREATE TYPE "cost_category" AS ENUM ('Feed', 'Chicks', 'Health', 'Bedding', 'Labour', 'Equipment', 'Cleaning', 'Transport', 'Processing', 'Utilities', 'FinancialCharges', 'Other');

-- CreateEnum
CREATE TYPE "cost_behaviour" AS ENUM ('Fixed', 'Variable');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('Cash', 'Wave', 'OrangeMoney');

-- CreateEnum
CREATE TYPE "retention_class" AS ENUM ('OperationalProof', 'SupportingDocument');

-- CreateEnum
CREATE TYPE "cost_payment_kind" AS ENUM ('Paid', 'ToPay', 'PaidBy');

-- CreateEnum
CREATE TYPE "settlement_direction" AS ENUM ('ToCounterparty', 'FromCounterparty');

-- CreateEnum
CREATE TYPE "sale_pricing_kind" AS ENUM ('PerBird', 'PerKilo');

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
    "avatar" "account_avatar",
    "audio_language" "audio_language",
    "pin_hash" TEXT NOT NULL,
    "provisional_pin_expires_at" TIMESTAMPTZ(3),
    "pin_failures" INTEGER NOT NULL DEFAULT 0,
    "pin_last_failure_at" TIMESTAMPTZ(3),
    "blocked_at" TIMESTAMPTZ(3),
    "sessions_valid_from" TIMESTAMPTZ(3),
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
    "audio_language" "audio_language",
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
    "strain" TEXT NOT NULL,
    "planned_headcount" INTEGER NOT NULL,
    "planned_duration" INTEGER NOT NULL,
    "closed_at" TIMESTAMPTZ(3),
    "leftovers_to" UUID,
    "closing_comment" TEXT,
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
    "device_id" UUID NOT NULL,
    "type" "journal_event_type",
    "fact" JSONB,
    "corrects" UUID,
    "retracts" UUID,

    CONSTRAINT "journal_events_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "refused_events" (
    "tenant_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "event" JSONB NOT NULL,
    "refusal" JSONB NOT NULL,

    CONSTRAINT "refused_events_pkey" PRIMARY KEY ("tenant_id","event_id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "action" "audit_action" NOT NULL,
    "actor_id" UUID,
    "subject_id" UUID NOT NULL,
    "site_id" UUID,
    "device_id" UUID,
    "reason" TEXT,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "counterparties" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "kind" "counterparty_kind" NOT NULL,
    "name" TEXT NOT NULL,
    "face" TEXT NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "counterparties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_types" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "category" "cost_category" NOT NULL,
    "name" TEXT NOT NULL,
    "behaviour" "cost_behaviour" NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_lines" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "category" "cost_category" NOT NULL,
    "campaign_id" UUID NOT NULL,
    "amount" INTEGER,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,
    "recorded_by" UUID NOT NULL,

    CONSTRAINT "budget_lines_pkey" PRIMARY KEY ("tenant_id","id","category")
);

-- CreateTable
CREATE TABLE "campaign_leftovers" (
    "tenant_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "cost_type_id" UUID NOT NULL,
    "whole" INTEGER NOT NULL,
    "opened" BOOLEAN NOT NULL,

    CONSTRAINT "campaign_leftovers_pkey" PRIMARY KEY ("tenant_id","campaign_id","cost_type_id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "order_day" DATE NOT NULL,
    "reference" TEXT,
    "currency" TEXT NOT NULL,
    "announced_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "paid_on" DATE NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" "payment_method" NOT NULL,
    "paid_by_id" UUID,
    "recorded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_lines" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "cost_type_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" INTEGER NOT NULL,

    CONSTRAINT "order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media" (
    "tenant_id" UUID NOT NULL,
    "sha256" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "content_type" TEXT NOT NULL,
    "retention_class" "retention_class" NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "uploaded_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "media_pkey" PRIMARY KEY ("tenant_id","sha256")
);

-- CreateTable
CREATE TABLE "costs" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "corrects" UUID,
    "campaign_id" UUID NOT NULL,
    "cost_type_id" UUID NOT NULL,
    "spent_on" DATE NOT NULL,
    "amount" INTEGER NOT NULL,
    "note" TEXT,
    "payment_kind" "cost_payment_kind" NOT NULL,
    "counterparty_id" UUID,
    "receipt" TEXT,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,
    "recorded_by" UUID NOT NULL,

    CONSTRAINT "costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlements" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "counterparty_id" UUID NOT NULL,
    "paid_on" DATE NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" "payment_method" NOT NULL,
    "direction" "settlement_direction" NOT NULL,
    "recorded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "buyer_id" UUID NOT NULL,
    "sold_on" DATE NOT NULL,
    "birds" INTEGER NOT NULL,
    "pricing_kind" "sale_pricing_kind" NOT NULL,
    "unit_price" INTEGER NOT NULL,
    "grams" INTEGER,
    "amount" INTEGER NOT NULL,
    "recorded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_receipts" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "paid_on" DATE NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" "payment_method" NOT NULL,
    "recorded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weighing_requests" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "requested_for" DATE NOT NULL,
    "requested_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weighing_requests_pkey" PRIMARY KEY ("id")
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

-- CreateIndex
CREATE INDEX "audit_events_tenant_id_subject_id_occurred_at_idx" ON "audit_events"("tenant_id", "subject_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "counterparties_tenant_id_id_key" ON "counterparties"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "cost_types_tenant_id_id_key" ON "cost_types"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "budget_lines_tenant_id_campaign_id_idx" ON "budget_lines"("tenant_id", "campaign_id");

-- CreateIndex
CREATE INDEX "purchase_orders_tenant_id_campaign_id_idx" ON "purchase_orders"("tenant_id", "campaign_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_tenant_id_id_key" ON "purchase_orders"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "payments_tenant_id_order_id_idx" ON "payments"("tenant_id", "order_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_tenant_id_id_key" ON "payments"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "order_lines_tenant_id_order_id_idx" ON "order_lines"("tenant_id", "order_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_lines_tenant_id_id_key" ON "order_lines"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "costs_tenant_id_campaign_id_idx" ON "costs"("tenant_id", "campaign_id");

-- CreateIndex
CREATE UNIQUE INDEX "costs_tenant_id_id_key" ON "costs"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "settlements_tenant_id_counterparty_id_idx" ON "settlements"("tenant_id", "counterparty_id");

-- CreateIndex
CREATE UNIQUE INDEX "settlements_tenant_id_id_key" ON "settlements"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "sales_tenant_id_campaign_id_idx" ON "sales"("tenant_id", "campaign_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_tenant_id_id_key" ON "sales"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "sale_receipts_tenant_id_sale_id_idx" ON "sale_receipts"("tenant_id", "sale_id");

-- CreateIndex
CREATE UNIQUE INDEX "sale_receipts_tenant_id_id_key" ON "sale_receipts"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "weighing_requests_tenant_id_campaign_id_idx" ON "weighing_requests"("tenant_id", "campaign_id");

-- CreateIndex
CREATE UNIQUE INDEX "weighing_requests_tenant_id_id_key" ON "weighing_requests"("tenant_id", "id");

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
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_tenant_id_leftovers_to_fkey" FOREIGN KEY ("tenant_id", "leftovers_to") REFERENCES "campaigns"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

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

-- AddForeignKey
ALTER TABLE "refused_events" ADD CONSTRAINT "refused_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "refused_events" ADD CONSTRAINT "refused_events_tenant_id_site_id_fkey" FOREIGN KEY ("tenant_id", "site_id") REFERENCES "sites"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "refused_events" ADD CONSTRAINT "refused_events_tenant_id_campaign_id_fkey" FOREIGN KEY ("tenant_id", "campaign_id") REFERENCES "campaigns"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "refused_events" ADD CONSTRAINT "refused_events_tenant_id_author_id_fkey" FOREIGN KEY ("tenant_id", "author_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_tenant_id_site_id_fkey" FOREIGN KEY ("tenant_id", "site_id") REFERENCES "sites"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "counterparties" ADD CONSTRAINT "counterparties_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "cost_types" ADD CONSTRAINT "cost_types_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_tenant_id_campaign_id_fkey" FOREIGN KEY ("tenant_id", "campaign_id") REFERENCES "campaigns"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "campaign_leftovers" ADD CONSTRAINT "campaign_leftovers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "campaign_leftovers" ADD CONSTRAINT "campaign_leftovers_tenant_id_campaign_id_fkey" FOREIGN KEY ("tenant_id", "campaign_id") REFERENCES "campaigns"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "campaign_leftovers" ADD CONSTRAINT "campaign_leftovers_tenant_id_cost_type_id_fkey" FOREIGN KEY ("tenant_id", "cost_type_id") REFERENCES "cost_types"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_id_supplier_id_fkey" FOREIGN KEY ("tenant_id", "supplier_id") REFERENCES "counterparties"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_id_campaign_id_fkey" FOREIGN KEY ("tenant_id", "campaign_id") REFERENCES "campaigns"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_order_id_fkey" FOREIGN KEY ("tenant_id", "order_id") REFERENCES "purchase_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_paid_by_id_fkey" FOREIGN KEY ("tenant_id", "paid_by_id") REFERENCES "counterparties"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_tenant_id_order_id_fkey" FOREIGN KEY ("tenant_id", "order_id") REFERENCES "purchase_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_tenant_id_cost_type_id_fkey" FOREIGN KEY ("tenant_id", "cost_type_id") REFERENCES "cost_types"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "costs" ADD CONSTRAINT "costs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "costs" ADD CONSTRAINT "costs_tenant_id_campaign_id_fkey" FOREIGN KEY ("tenant_id", "campaign_id") REFERENCES "campaigns"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "costs" ADD CONSTRAINT "costs_tenant_id_cost_type_id_fkey" FOREIGN KEY ("tenant_id", "cost_type_id") REFERENCES "cost_types"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "costs" ADD CONSTRAINT "costs_tenant_id_counterparty_id_fkey" FOREIGN KEY ("tenant_id", "counterparty_id") REFERENCES "counterparties"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "costs" ADD CONSTRAINT "costs_tenant_id_corrects_fkey" FOREIGN KEY ("tenant_id", "corrects") REFERENCES "costs"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_tenant_id_counterparty_id_fkey" FOREIGN KEY ("tenant_id", "counterparty_id") REFERENCES "counterparties"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_tenant_id_campaign_id_fkey" FOREIGN KEY ("tenant_id", "campaign_id") REFERENCES "campaigns"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_tenant_id_buyer_id_fkey" FOREIGN KEY ("tenant_id", "buyer_id") REFERENCES "counterparties"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sale_receipts" ADD CONSTRAINT "sale_receipts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sale_receipts" ADD CONSTRAINT "sale_receipts_tenant_id_sale_id_fkey" FOREIGN KEY ("tenant_id", "sale_id") REFERENCES "sales"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "weighing_requests" ADD CONSTRAINT "weighing_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "weighing_requests" ADD CONSTRAINT "weighing_requests_tenant_id_campaign_id_fkey" FOREIGN KEY ("tenant_id", "campaign_id") REFERENCES "campaigns"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

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
-- Migrations and provisioning run as the owner of the tables, never as `yaar_app`. That owner
-- is neither superuser nor BYPASSRLS (D.6): the forced policies bind it too, and it cannot
-- create a role. Both roles are created with the database server, by its superuser
-- (infra/postgres/init-roles.sh), before any migration; a server without them stops here.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'yaar_app') THEN
    RAISE EXCEPTION 'The role yaar_app is missing: it is created with the database server (infra/postgres/init-roles.sh), before any migration.';
  END IF;
END
$$;

-- Least privilege, table by table. No GRANT ON ALL TABLES and no default privileges: a table
-- added later is closed until its migration opens it. No DELETE (nothing is erased here,
-- except an assignment to a site) and no TRUNCATE (it bypasses RLS).
GRANT USAGE ON SCHEMA public TO yaar_app;
-- A farm reads its own row; farms are created by provisioning, as the owner.
GRANT SELECT ON "tenants" TO yaar_app;
GRANT SELECT, INSERT, UPDATE ON "users" TO yaar_app;
GRANT SELECT, INSERT, UPDATE ON "sites" TO yaar_app;
-- Removing a collaborator from a site erases the assignment (E.7); the audit trail keeps it.
GRANT SELECT, INSERT, UPDATE, DELETE ON "site_assignments" TO yaar_app;
GRANT SELECT, INSERT, UPDATE ON "campaigns" TO yaar_app;
-- A counterparty is archived, never deleted (N.3): no DELETE.
GRANT SELECT, INSERT, UPDATE ON "counterparties" TO yaar_app;
-- A cost type is archived, never deleted (N.2): no DELETE.
GRANT SELECT, INSERT, UPDATE ON "cost_types" TO yaar_app;
-- An order is never deleted; it is closed (Q.4).
GRANT SELECT, INSERT, UPDATE ON "purchase_orders" TO yaar_app;
-- A draft's lines are rewritten whole (Q.4): erased, then written again. Never updated.
GRANT SELECT, INSERT, DELETE ON "order_lines" TO yaar_app;
-- A payment is a money entry: written once, never updated nor deleted (Q.9, rule 2).
GRANT SELECT, INSERT ON "payments" TO yaar_app;
-- A media row is added once; the file is never removed (M.1, rule 13).
GRANT SELECT, INSERT ON "media" TO yaar_app;
-- A cost is a money entry: added once, corrected by another row, never updated nor deleted (P.2).
GRANT SELECT, INSERT ON "costs" TO yaar_app;
-- A settlement is a money entry: added once, never updated nor deleted (R.2).
GRANT SELECT, INSERT ON "settlements" TO yaar_app;
-- A sale and its receipts are money entries: added once, never updated nor deleted (W.1).
GRANT SELECT, INSERT ON "sales" TO yaar_app;
GRANT SELECT, INSERT ON "sale_receipts" TO yaar_app;
-- A request for a weighing is added once; what answers it is read from the journal (T.2).
GRANT SELECT, INSERT ON "weighing_requests" TO yaar_app;
-- Leftovers are written once, with the closing (X.2): never updated nor deleted.
GRANT SELECT, INSERT ON "campaign_leftovers" TO yaar_app;
-- A budget is written again whole, never updated nor deleted (S.1): the latest written counts.
GRANT SELECT, INSERT ON "budget_lines" TO yaar_app;
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

ALTER TABLE "purchase_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_orders" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "purchase_orders"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "order_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "order_lines"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "budget_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "budget_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "budget_lines"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE "campaign_leftovers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "campaign_leftovers" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "campaign_leftovers"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE "weighing_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "weighing_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "weighing_requests"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "sales" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sales" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sales"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "sale_receipts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sale_receipts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sale_receipts"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "settlements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "settlements" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "settlements"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "costs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "costs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "costs"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "media" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "media" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "media"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "payments"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "cost_types" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cost_types" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "cost_types"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "counterparties" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "counterparties" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "counterparties"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "campaigns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "campaigns" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "campaigns"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Everything below is written by hand: Prisma describes none of it.

-- A cost owed names whom it is owed to, a cost paid by someone else names who paid (R.4); a cost
-- the farm paid names nobody. A correction names another cost.
ALTER TABLE "costs" ADD CONSTRAINT "costs_payment_shape" CHECK (("payment_kind" IN ('ToPay', 'PaidBy')) = ("counterparty_id" IS NOT NULL));
ALTER TABLE "costs" ADD CONSTRAINT "costs_corrects_another" CHECK ("corrects" IS DISTINCT FROM "id");

-- A budget is a plan in whole units, zero allowed, never below (S.1).
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_amount" CHECK ("amount" IS NULL OR "amount" >= 0);
-- A leftover is whole ones, an opened one, or both; never nothing, never below zero (X.1).
ALTER TABLE "campaign_leftovers" ADD CONSTRAINT "campaign_leftovers_shape" CHECK ("whole" >= 0 AND ("whole" > 0 OR "opened"));
-- What the closing writes exists only once closed, and leftovers go to another campaign (X.2).
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_closing_shape" CHECK ("closed_at" IS NOT NULL OR ("leftovers_to" IS NULL AND "closing_comment" IS NULL));
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_leftovers_elsewhere" CHECK ("leftovers_to" IS DISTINCT FROM "id");
-- A sale by the kilo carries its weight; a sale by the head carries none.
ALTER TABLE "sales" ADD CONSTRAINT "sales_pricing_shape" CHECK (("pricing_kind" = 'PerKilo') = ("grams" IS NOT NULL));

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
CREATE FUNCTION refuse_change() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is refused', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;

CREATE TRIGGER journal_events_no_update_no_delete
  BEFORE UPDATE OR DELETE ON "journal_events"
  FOR EACH ROW EXECUTE FUNCTION refuse_change();

CREATE TRIGGER journal_events_no_truncate
  BEFORE TRUNCATE ON "journal_events"
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();

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

-- The audit trail (CLAUDE.md §4 rule 14): read and added to by the application, never changed
-- nor erased — by anyone.
GRANT SELECT, INSERT ON "audit_events" TO yaar_app;

ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "audit_events"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE TRIGGER audit_events_no_update_no_delete
  BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION refuse_change();

CREATE TRIGGER audit_events_no_truncate
  BEFORE TRUNCATE ON "audit_events"
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();

-- The refused declarations (G.5, decision of 2026-11-08): kept for the chef, read and added to
-- by the application, never changed nor erased — by anyone. Its reception date is the
-- database's own, like the journal's.
GRANT SELECT, INSERT ON "refused_events" TO yaar_app;

ALTER TABLE "refused_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "refused_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "refused_events"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE TRIGGER refused_events_no_update_no_delete
  BEFORE UPDATE OR DELETE ON "refused_events"
  FOR EACH ROW EXECUTE FUNCTION refuse_change();

CREATE TRIGGER refused_events_no_truncate
  BEFORE TRUNCATE ON "refused_events"
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();

CREATE TRIGGER refused_events_received_at
  BEFORE INSERT ON "refused_events"
  FOR EACH ROW EXECUTE FUNCTION journal_events_stamp_reception();
