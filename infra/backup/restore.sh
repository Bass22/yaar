#!/bin/sh
# Restores a backup (Z.4) on an EMPTY instance: the database, then the media, then the stack
# starts. It refuses a database that already has tables: a restoration never overwrites.
#
#   infra/backup/restore.sh /srv/sauvegardes/yaar-2026-11-12T020000Z.tar.age cle-privee.txt
#
# On a new server: copy the repository and infra/.env, run this script — it starts the database
# alone (an empty volume creates its roles), restores, then brings the whole stack up. The
# private key is read from its file only for the time of the decryption.
set -eu
umask 077

here=$(cd "$(dirname "$0")" && pwd)
# The stack's files: the compose alone, or the list in COMPOSE_FILE (in production, with its
# overlay: COMPOSE_FILE=infra/docker-compose.yml:infra/docker-compose.prod.yml), so that a
# restoration brings the stack back as it ran — HTTPS included.
C() {
  if [ -n "${COMPOSE_FILE:-}" ]; then docker compose ${COMPOSE_PROJECT:+-p "$COMPOSE_PROJECT"} "$@"
  else docker compose ${COMPOSE_PROJECT:+-p "$COMPOSE_PROJECT"} -f "$here/../docker-compose.yml" "$@"; fi
}
die() { echo "restore: $*" >&2; exit 1; }
sha() { if command -v sha256sum > /dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }
# Built apart and quietly: a first build would otherwise print into the encrypted stream.
age_ready() { C --profile tools build -q age > /dev/null 2>&1 || die "l'image d'age ne se construit pas"; }

[ $# -eq 2 ] || die "usage : restore.sh <archive.tar.age> <clé-privée.txt>"
[ -r "$1" ] || die "archive illisible : $1"
[ -r "$2" ] || die "clé privée illisible : $2"
archive=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
identity=$(cd "$(dirname "$2")" && pwd)/$(basename "$2")
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT INT TERM

age_ready
C --profile tools run --rm -T -v "$identity:/identity:ro" age -d -i /identity < "$archive" > "$work/bundle.tar" \
  || die "déchiffrement impossible : ce n'est pas la clé de cette sauvegarde, ou l'archive est abîmée"
tar -C "$work" -xf "$work/bundle.tar" || die "archive abîmée"
rm -f "$work/bundle.tar"
(cd "$work" && sha -c manifest.sha256 > /dev/null) || die "une pièce de l'archive ne correspond pas à son empreinte"

C up -d --wait db > /dev/null
tables=$(C exec -T db psql -U postgres -d yaar -tAc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")
[ "$tables" = 0 ] || die "la base n'est pas vide ($tables tables) : une restauration se fait sur une instance neuve"
media=$(C run --rm --no-deps -T --entrypoint sh api -c 'find /data/medias -mindepth 1 | wc -l')
[ "$(echo "$media" | tr -d ' \r')" = 0 ] || die "le volume des médias n'est pas vide : une restauration se fait sur une instance neuve"

# All or nothing, as the superuser through the local socket: owners, grants and row security
# come back with the tables.
C exec -T db pg_restore -U postgres -d yaar --exit-on-error --single-transaction < "$work/db.dump" || die "la base n'a pas pu être restaurée"
C run --rm --no-deps -T --entrypoint tar api -C /data/medias -xf - < "$work/medias.tar" || die "les médias n'ont pas pu être restaurés"

C up -d --wait > /dev/null
echo "Restaurée : $(basename "$archive")"
