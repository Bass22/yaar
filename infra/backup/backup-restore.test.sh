#!/bin/sh
# Spec: backlog Z.4 — sauvegarder et restaurer ; docs/architecture.md §9 « Sauvegardes »
# (décisions du fondateur du 2026-11-12 : une archive chiffrée par clé publique, la clé privée
# hors du serveur ; 30 jours gardés ; restauration sur une instance vide seulement).
#
# La preuve que la restauration marche est une restauration jouée : une vraie pile, des données
# et une photo, une sauvegarde, la pile détruite (volumes compris), la restauration, et les mêmes
# chiffres et les mêmes médias qu'avant. Quelques minutes : les images se construisent.
#
#   infra/backup/backup-restore.test.sh
#
# Elle tourne sous un nom de projet à part, avec ses propres secrets jetables, sans toucher à
# infra/.env ni à une autre pile ; elle détruit tout ce qu'elle a créé en sortant.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
export COMPOSE_PROJECT="yaar-backup-test-$$"
export DB_PASSWORD=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
export APP_DB_PASSWORD=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
export JWT_SECRET=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')
export WEB_PORT=$((20000 + $$ % 20000))
work=$(mktemp -d)
C() { docker compose -p "$COMPOSE_PROJECT" -f "$here/../docker-compose.yml" --env-file /dev/null "$@"; }

cleanup() {
  C --profile tools down -v --rmi local --remove-orphans > /dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT INT TERM

failures=0
check() { # check "titre" commande…
  title=$1; shift
  if "$@"; then echo "  ✓ $title"; else echo "  ✗ $title"; failures=$((failures + 1)); fi
}

sql() { C exec -T db psql -U postgres -d yaar -v ON_ERROR_STOP=1 -tAq "$@"; }

# What « the same figures » means: every table of the application, its row count and a digest
# of its rows; every media, its path and its digest.
fingerprint() {
  for table in $(sql -c "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"); do
    printf '%s ' "$table"
    sql -c "SELECT count(*) || ':' || coalesce(md5(string_agg(x::text, ',' ORDER BY x::text)), '') FROM \"$table\" x"
  done
  C exec -T api sh -c 'cd /data/medias && find . -path ./.tmp -prune -o -type f -print | sort | xargs -r sha256sum'
}

echo "Sauvegarder et restaurer — une vraie pile ($COMPOSE_PROJECT)"
C up -d --build --wait > "$work/up.log" 2>&1 || { cat "$work/up.log"; exit 1; }

# Given un élevage, son site, une bande, une mort au journal, une dépense de 12 500 F et une photo
TENANT=00000000-0000-4000-8000-0000000000a1
SITE=00000000-0000-4000-8000-0000000000a2
CAMPAIGN=00000000-0000-4000-8000-0000000000a3
USER_ID=00000000-0000-4000-8000-0000000000a4
COST_TYPE=00000000-0000-4000-8000-0000000000a5
sql > /dev/null <<SQL
INSERT INTO tenants (id, name, currency) VALUES ('$TENANT', 'Ferme Témoin Ndiaye', 'XOF');
INSERT INTO sites (id, tenant_id, name, time_zone) VALUES ('$SITE', '$TENANT', 'Poulailler Nord', 'Africa/Dakar');
INSERT INTO users (id, tenant_id, phone, name, role, pin_hash) VALUES ('$USER_ID', '$TENANT', '+221770000001', 'Ousmane', 'collaborator', 'x');
INSERT INTO campaigns (id, tenant_id, site_id, placement_day, strain, planned_headcount, planned_duration) VALUES ('$CAMPAIGN', '$TENANT', '$SITE', '2026-10-12', 'Cobb500', 1000, 45);
INSERT INTO journal_events (id, tenant_id, site_id, campaign_id, author_id, device_id, business_date, recorded_at, type, fact)
  VALUES ('00000000-0000-4000-8000-0000000000a6', '$TENANT', '$SITE', '$CAMPAIGN', '$USER_ID', '$USER_ID', '2026-10-17', '2026-10-17T18:00:00Z', 'Death', '{"quantity": 3}');
INSERT INTO cost_types (id, tenant_id, category, name, behaviour) VALUES ('$COST_TYPE', '$TENANT', 'Health', 'Vaccin', 'Variable');
INSERT INTO costs (id, tenant_id, campaign_id, cost_type_id, spent_on, amount, payment_kind, recorded_at, recorded_by)
  VALUES ('00000000-0000-4000-8000-0000000000a7', '$TENANT', '$CAMPAIGN', '$COST_TYPE', '2026-10-13', 12500, 'Paid', '2026-10-13T08:00:00Z', '$USER_ID');
SQL
C exec -T api sh -c 'mkdir -p /data/medias/ab && printf "photo des morts du 17 octobre" > /data/medias/ab/abcdef.jpg && mkdir -p /data/medias/.tmp && printf "envoi interrompu" > /data/medias/.tmp/partiel'
fingerprint > "$work/before.txt"

# A key pair: the public key stays on the server, the private one with the publisher.
C --profile tools build -q age > /dev/null 2>&1
C --profile tools run --rm -T --entrypoint age-keygen age 2> /dev/null > "$work/identity.txt"
recipient=$(sed -n 's/^# public key: //p' "$work/identity.txt")
chmod 600 "$work/identity.txt"

# An archive older than 30 days, which the next backup removes.
mkdir -p "$work/backups"
old=$(date -u -v-40d +%Y%m%d%H%M 2> /dev/null || date -u -d '40 days ago' +%Y%m%d%H%M)
touch -t "$old" "$work/backups/yaar-2026-01-01T020000Z.tar.age"

# When on sauvegarde
BACKUP_RECIPIENT=$recipient BACKUP_DIR="$work/backups" "$here/backup.sh" > "$work/backup.log" 2>&1 || { cat "$work/backup.log"; exit 1; }
archive=$(find "$work/backups" -name 'yaar-*.tar.age' -newer "$work/before.txt" | head -1)

echo "La sauvegarde"
check "une archive est écrite, nommée par sa date" test -s "$archive"
check "elle est chiffrée : ce n'est pas une archive lisible" sh -c "! tar -tf '$archive' > /dev/null 2>&1"
check "le nom de l'élevage n'y est pas en clair" sh -c "! grep -q 'Témoin Ndiaye' '$archive'"
check "la photo n'y est pas en clair" sh -c "! grep -q 'photo des morts' '$archive'"
check "aucune pièce en clair ne reste à côté" sh -c "test \"\$(find '$work/backups' -type f | wc -l | tr -d ' ')\" = 1"
check "les archives de plus de 30 jours sont retirées" test ! -e "$work/backups/yaar-2026-01-01T020000Z.tar.age"
check "l'archive n'est lisible que par son propriétaire" sh -c "ls -l '$archive' | grep -q '^-rw-------'"

echo "Restaurer"
check "une restauration sur une instance qui a déjà des données est refusée" sh -c "! '$here/restore.sh' '$archive' '$work/identity.txt' > '$work/refused.log' 2>&1"
check "le refus le dit, et c'est la base qui est jugée d'abord" grep -q "la base n'est pas vide" "$work/refused.log"

# Then la pile est détruite, volumes compris, et rendue vide
C down -v > /dev/null 2>&1
C up -d --wait db > /dev/null 2>&1

C --profile tools run --rm -T --entrypoint age-keygen age 2> /dev/null > "$work/wrong.txt"
check "une autre clé privée n'ouvre pas la sauvegarde" sh -c "! '$here/restore.sh' '$archive' '$work/wrong.txt' > /dev/null 2>&1"
check "et rien n'a été écrit dans la base vide" test "$(sql -c "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")" = 0

"$here/restore.sh" "$archive" "$work/identity.txt" > "$work/restore.log" 2>&1 || { cat "$work/restore.log"; exit 1; }
fingerprint > "$work/after.txt"

check "les mêmes chiffres et les mêmes médias qu'avant la sauvegarde" diff "$work/before.txt" "$work/after.txt"
check "un envoi interrompu (.tmp) n'est ni sauvegardé ni restauré" C exec -T api test ! -e /data/medias/.tmp/partiel
as_app() { sql -c "SET ROLE yaar_app" -c "$1" | tail -1; }
without_tenant=$(as_app "SELECT count(*) FROM campaigns")
with_tenant=$(as_app "SELECT set_config('app.tenant_id', '$TENANT', false) || ':' || (SELECT count(*) FROM campaigns)")
check "sans tenant, le rôle de l'application ne voit rien (la RLS est revenue) — vu : $without_tenant" test "$without_tenant" = 0
check "avec le tenant, il voit la bande restaurée — vu : $with_tenant" test "$with_tenant" = "$TENANT:1"
# The readiness probe is not offered through Caddy (R-9): asked from inside the API container.
check "l'API répond de nouveau, sa base prête" C exec -T api node -e "fetch('http://localhost:3000/api/v1/health/ready').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

if [ "$failures" -gt 0 ]; then
  echo "$failures vérification(s) en échec"
  exit 1
fi
echo "Tout est vérifié."
