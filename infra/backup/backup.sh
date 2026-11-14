#!/bin/sh
# One backup of the stack (Z.4; docs/architecture.md §9): the database, then the media, in a
# single archive encrypted for a public key. The server holds that public key only: it writes
# backups it cannot read. Old archives go after BACKUP_KEEP_DAYS days (30 by default).
#
#   BACKUP_RECIPIENT=age1…  BACKUP_DIR=/srv/sauvegardes  infra/backup/backup.sh
#
# The database first, the media after: a photo stored in between is at worst one file too many,
# never a row without its file. Media are named by their content and never rewritten, so they
# are read while the stack runs; an upload under way (.tmp) is left out.
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
die() { echo "backup: $*" >&2; exit 1; }
sha() { if command -v sha256sum > /dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }
# Built apart and quietly: a first build would otherwise print into the encrypted stream.
age_ready() { C --profile tools build -q age > /dev/null 2>&1 || die "l'image d'age ne se construit pas"; }

[ -n "${BACKUP_RECIPIENT:-}" ] || die "BACKUP_RECIPIENT manquant : la clé publique age (age1…) de l'éditeur"
[ -n "${BACKUP_DIR:-}" ] || die "BACKUP_DIR manquant : le dossier des sauvegardes"
keep=${BACKUP_KEEP_DAYS:-30}
stamp=$(date -u +%Y-%m-%dT%H%M%SZ)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT INT TERM

# The superuser, through the socket of the database container: it reads every farm, which row
# security keeps from any other role (CLAUDE.md §8). No password, no network.
C exec -T db pg_dump -U postgres -d yaar --format=custom > "$work/db.dump" || die "la base n'a pas pu être lue"
C exec -T api tar -C /data/medias --exclude=./.tmp -cf - . > "$work/medias.tar" || die "les médias n'ont pas pu être lus"
(cd "$work" && sha db.dump medias.tar > manifest.sha256)
printf 'Sauvegarde Yaar du %s\n' "$stamp" > "$work/README.txt"

age_ready
mkdir -p "$BACKUP_DIR"
target="$BACKUP_DIR/yaar-$stamp.tar.age"
# Written under a temporary name, renamed once complete: a cut-off backup never looks whole.
tar -C "$work" -cf - README.txt manifest.sha256 db.dump medias.tar \
  | C --profile tools run --rm -T age -r "$BACKUP_RECIPIENT" > "$target.partial" \
  || { rm -f "$target.partial"; die "le chiffrement a échoué"; }
[ -s "$target.partial" ] || { rm -f "$target.partial"; die "l'archive chiffrée est vide"; }
mv "$target.partial" "$target"

find "$BACKUP_DIR" -name 'yaar-*.tar.age' -type f -mtime +"$keep" -exec rm -f {} +
echo "$target"
