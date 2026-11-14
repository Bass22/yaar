#!/bin/sh
# A local stack as production runs it, to try the whole application by hand: built images, a
# fresh database, a farm bootstrapped by the operator's script, its admin, a caretaker on its
# site with their own PIN. No campaign, no order: everything is created through the screens.
#
#   infra/local-stack.sh          # recreates it: THE PREVIOUS LOCAL DATA IS DESTROYED
#
# Secrets are drawn once and kept in ~/.yaar-local.env (mode 600); the accesses (numbers and
# PINs, test values for this stack only) are written to ~/yaar-acces-local.txt (mode 600), never
# printed. Open http://localhost:8088 once it is done.
set -eu
umask 077

here=$(cd "$(dirname "$0")" && pwd)
project=yaar-local
env_file=${YAAR_LOCAL_ENV:-$HOME/.yaar-local.env}
access_file=${YAAR_LOCAL_ACCESS:-$HOME/yaar-acces-local.txt}
port=${YAAR_LOCAL_PORT:-8088}
api="http://localhost:$port/api/v1"
C() { docker compose -p "$project" --env-file "$env_file" -f "$here/docker-compose.yml" "$@"; }
die() { echo "local-stack: $*" >&2; exit 1; }
hex() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }
# A PIN of n digits the rules accept (E.1): neither one digit repeated nor a run up or down.
pin() {
  node -e "
    const n = Number(process.argv[1]); const { randomInt } = require('node:crypto');
    for (;;) {
      const pin = Array.from({ length: n }, () => randomInt(10)).join('');
      const steps = new Set([...pin].slice(1).map((d, i) => Number(d) - Number(pin[i])));
      if (new Set(pin).size > 1 && !(steps.size === 1 && (steps.has(1) || steps.has(-1)))) { process.stdout.write(pin); break; }
    }" "$1"
}
uuid() { node -e "process.stdout.write(require('node:crypto').randomUUID())"; }
json() { node -e "let s=''; process.stdin.on('data', (c) => s += c).on('end', () => process.stdout.write(String(JSON.parse(s)[process.argv[1]] ?? '')))" "$1"; }

if [ ! -f "$env_file" ]; then
  printf 'DB_PASSWORD=%s\nAPP_DB_PASSWORD=%s\nJWT_SECRET=%s\nWEB_PORT=%s\n' "$(hex 32)" "$(hex 32)" "$(hex 32)" "$port" > "$env_file"
  node "$here/../tools/vapid-keys.mjs" >> "$env_file"
  echo 'VAPID_SUBJECT=https://localhost' >> "$env_file"
  chmod 600 "$env_file"
fi

echo "Pile locale « $project » : base neuve, images construites (quelques minutes)…"
C --profile tools down -v --remove-orphans > /dev/null 2>&1 || true
C up -d --build --wait > /dev/null 2>&1 || die "la pile n'a pas démarré : docker compose -p $project logs"

admin_phone=+221770000054
admin_pin=$(pin 6)
# The operator's script, as in production; the PIN goes through a pipe, never on a command line.
printf '%s\n' "$admin_pin" | C run --rm -T migrate node dist/bootstrap-tenant.js \
  --tenant "Ferme de démonstration" --site "Poulailler Nord" --time-zone Africa/Dakar --admin-name "Bassirou" --admin-phone "$admin_phone" > /dev/null \
  || die "l'amorçage de l'élevage a échoué"

device=$(uuid)
token=$(curl -fsS -X POST "$api/auth/sign-in" -H 'content-type: application/json' \
  -d "{\"phone\":\"$admin_phone\",\"pin\":\"$admin_pin\",\"deviceId\":\"$device\"}" | json token) || die "l'admin ne se connecte pas"
[ -n "$token" ] || die "l'admin ne se connecte pas"

caretaker=$(uuid)
caretaker_phone=+221770000051
provisional=$(curl -fsS -X POST "$api/users" -H "authorization: Bearer $token" -H 'content-type: application/json' \
  -d "{\"id\":\"$caretaker\",\"phone\":\"$caretaker_phone\",\"name\":\"Ousmane\",\"avatar\":\"baobab\",\"language\":\"fr\"}" | json provisionalPin) || die "le compte du gardien n'a pas été créé"
site=$(C exec -T db psql -U postgres -d yaar -tAc "SELECT id FROM sites LIMIT 1" | tr -d '[:space:]')
curl -fsS -o /dev/null -X PUT "$api/sites/$site/staff/$caretaker" -H "authorization: Bearer $token" || die "le gardien n'a pas été affecté"
curl -fsS -o /dev/null -X PUT "$api/sites/$site/primary-caretaker" -H "authorization: Bearer $token" -H 'content-type: application/json' -d "{\"userId\":\"$caretaker\"}" || die "le titulaire n'a pas été désigné"
caretaker_pin=$(pin 4)
curl -fsS -o /dev/null -X POST "$api/auth/choose-pin" -H 'content-type: application/json' \
  -d "{\"phone\":\"$caretaker_phone\",\"provisionalPin\":\"$provisional\",\"newPin\":\"$caretaker_pin\",\"deviceId\":\"$(uuid)\"}" || die "le gardien n'a pas choisi son PIN"

cat > "$access_file" <<EOF
Yaar — pile LOCALE de test (« $project »), créée le $(date '+%Y-%m-%d %H:%M'). Aucune donnée réelle.
Valeurs de test pour cette pile seulement : à ne jamais réutiliser ailleurs.

Adresse : http://localhost:$port

Admin (Bassirou)
  numéro : $admin_phone
  PIN    : $admin_pin

Gardien (Ousmane), titulaire du Poulailler Nord
  numéro : $caretaker_phone
  PIN    : $caretaker_pin

L'élevage : « Ferme de démonstration », un site « Poulailler Nord » (Africa/Dakar), les types de
coût d'office (dont Aliment démarrage, croissance, finition). Aucune bande : à ouvrir au bureau.
Recréer la pile à neuf (efface ses données) : infra/local-stack.sh
EOF
chmod 600 "$access_file"
echo "Prête : http://localhost:$port — les accès sont dans $access_file"
