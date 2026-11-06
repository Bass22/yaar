#!/bin/sh
# Gives the application role its login. Run by the PostgreSQL image once, when the data
# volume is first initialised (/docker-entrypoint-initdb.d) — before any migration.
#
# The API connects as `yaar_app`: it owns nothing and is bound by row-level security. The
# migrations (owner role) later find the role in place and only grant it what it needs.
# The password is passed as a psql variable and quoted by psql itself (:'…'), never pasted
# into the SQL text.
#
# A volume initialised before this script existed does not have the role's login: recreate
# the volume, or run once as the owner: ALTER ROLE yaar_app LOGIN PASSWORD '…';
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_password="$APP_DB_PASSWORD" <<'SQL'
CREATE ROLE yaar_app LOGIN PASSWORD :'app_password';
SQL
