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
