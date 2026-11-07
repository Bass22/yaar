#!/bin/sh
# Creates the two roles of the stack and the database. Run by the PostgreSQL image once, when
# the data volume is first initialised (/docker-entrypoint-initdb.d), as its superuser — before
# any migration. The superuser serves this initialisation only: no task of the stack runs
# under it (D.6), because a superuser escapes row-level security and can run programs. It
# then loses its password: nobody logs in as superuser over the network, and `DB_PASSWORD`,
# which the image needed to start, opens the owner only. Inside the container it still
# connects through the local socket: `docker compose exec db psql -U postgres`.
#
#   yaar      owns the database and the tables; migrations and the operator's scripts run
#             under it. Neither superuser nor BYPASSRLS: the forced policies bind it too.
#   yaar_app  the API. Owns nothing, bound by row-level security; the migrations grant it
#             what it needs, table by table.
#
# Passwords are passed as psql variables and quoted by psql itself (:'…'), never pasted into
# the SQL text.
#
# A volume initialised before this script existed keeps its old roles: recreate the volume
# while nothing is deployed.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v owner_password="$DB_PASSWORD" -v app_password="$APP_DB_PASSWORD" -v superuser="$POSTGRES_USER" <<'SQL'
CREATE ROLE yaar LOGIN PASSWORD :'owner_password' NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION;
CREATE ROLE yaar_app LOGIN PASSWORD :'app_password' NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION;
CREATE DATABASE yaar OWNER yaar;
ALTER ROLE :"superuser" PASSWORD NULL;
SQL
