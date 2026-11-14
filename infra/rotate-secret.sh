#!/bin/sh
# Changes one secret of the stack (Z.5; docs/deploiement.md « Changer un secret »), data untouched.
#
#   infra/rotate-secret.sh owner   # DB_PASSWORD, the owner of the tables (migrations, scripts)
#   infra/rotate-secret.sh app     # APP_DB_PASSWORD, the role of the API
#   infra/rotate-secret.sh jwt     # JWT_SECRET: everybody signs in again
#
# A database password is changed in the database first, then in infra/.env, then the stack
# restarts with it: changing infra/.env alone would cut the API off its database. The new value
# is drawn here, written only to infra/.env (mode 600), never printed nor logged.
set -eu
umask 077

here=$(cd "$(dirname "$0")" && pwd)
env_file=${YAAR_ENV_FILE:-$here/.env}
C() {
  if [ -n "${COMPOSE_FILE:-}" ]; then docker compose --env-file "$env_file" ${COMPOSE_PROJECT:+-p "$COMPOSE_PROJECT"} "$@"
  else docker compose --env-file "$env_file" ${COMPOSE_PROJECT:+-p "$COMPOSE_PROJECT"} -f "$here/docker-compose.yml" "$@"; fi
}
die() { echo "rotate-secret: $*" >&2; exit 1; }

case "${1:-}" in
  owner) variable=DB_PASSWORD; role=yaar ;;
  app) variable=APP_DB_PASSWORD; role=yaar_app ;;
  jwt) variable=JWT_SECRET; role= ;;
  *) die "usage : rotate-secret.sh owner|app|jwt" ;;
esac
[ -w "$env_file" ] || die "fichier d'environnement introuvable ou non modifiable : $env_file"
grep -q "^$variable=" "$env_file" || die "$variable absent de $env_file"

# Hexadecimal only: the value is pasted into a postgresql:// address, where « / » or « @ » would break it.
new=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')

if [ -n "$role" ]; then
  # Through the database container's socket, as the superuser; the password is a psql variable,
  # quoted by psql itself, and the statement is kept out of the server log.
  C exec -T db psql -U postgres -d yaar -v ON_ERROR_STOP=1 -q -v role="$role" -v password="$new" > /dev/null <<'SQL' || die "la base a refusé le changement : rien n'a été modifié"
SET log_statement = 'none';
SET log_min_error_statement = 'panic';
ALTER ROLE :"role" PASSWORD :'password';
SQL
fi

# Rewritten whole, then moved in place: a cut-off write never leaves a half file.
sed "s/^$variable=.*/$variable=$new/" "$env_file" > "$env_file.new"
chmod 600 "$env_file.new"
mv "$env_file.new" "$env_file"

C up -d --wait > /dev/null || die "la pile n'a pas redémarré : voir docker compose logs"
echo "$variable changé ; la pile a redémarré avec lui."
