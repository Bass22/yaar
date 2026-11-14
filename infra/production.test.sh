#!/bin/sh
# Spec: backlog Z.5 — mettre en production ; docs/deploiement.md ; réserves R-9, R-10, R-17.
#
# La pile de production jouée pour de vrai : la surcouche de production, un domaine (ici
# `localhost`, que Caddy certifie avec son autorité interne), HTTPS, et ce que la production
# promet — en-têtes, sonde fermée, certificat gardé, aucun secret dans une image ni dans le
# journal de la base, images épinglées. Quelques minutes : les images se construisent.
#
#   infra/production.test.sh
#
# Projet à part, secrets jetables, ports pris au hasard ; tout est détruit en sortant.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
export COMPOSE_PROJECT="yaar-production-test-$$"
export DB_PASSWORD=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
export APP_DB_PASSWORD=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
export JWT_SECRET=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')
export SITE_ADDRESS=localhost
HTTP_PORT=$((20000 + $$ % 10000))
HTTPS_PORT=$((30000 + $$ % 10000))
work=$(mktemp -d)
# The production overlay as written, plus test ports: the server's 80 and 443 stay free here.
cat > "$work/ports.yml" <<EOF
services:
  web:
    ports: !override
      - '$HTTP_PORT:80'
      - '$HTTPS_PORT:443'
EOF
C() { docker compose -p "$COMPOSE_PROJECT" --env-file /dev/null -f "$here/docker-compose.yml" -f "$here/docker-compose.prod.yml" -f "$work/ports.yml" "$@"; }

cleanup() {
  C down -v --rmi local --remove-orphans > /dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT INT TERM

failures=0
check() {
  title=$1; shift
  if "$@"; then echo "  ✓ $title"; else echo "  ✗ $title"; failures=$((failures + 1)); fi
}
header() { grep -i "^$1:" "$2" | head -1 | tr -d '\r'; }

echo "La pile de production ($COMPOSE_PROJECT)"

echo "Avant de démarrer"
check "toute image de base est épinglée par son empreinte (R-10)" sh -c "
  ! grep -h '^FROM ' '$here'/docker/*.Dockerfile | grep -v '@sha256:' | grep -q . &&
  ! grep -h '^ *image:' '$here/docker-compose.yml' | grep -v '@sha256:' | grep -q ."
check "sans domaine, la surcouche de production refuse de démarrer" sh -c "
  ! SITE_ADDRESS= docker compose -p x --env-file /dev/null -f '$here/docker-compose.yml' -f '$here/docker-compose.prod.yml' config > /dev/null 2>&1"
docker compose -p x --env-file /dev/null -f "$here/docker-compose.yml" -f "$here/docker-compose.prod.yml" config --format json > "$work/config.json"
check "seul le web publie des ports, et seulement 80 et 443" sh -c "
  node -e \"const c = require('$work/config.json');
    const published = Object.entries(c.services).flatMap(([name, s]) => (s.ports ?? []).map((p) => name + ':' + p.published + '/' + (p.protocol ?? 'tcp')));
    process.exit(JSON.stringify(published.sort()) === JSON.stringify(['web:443/tcp', 'web:443/udp', 'web:80/tcp']) ? 0 : 1)\""
check "le certificat est gardé dans un volume" sh -c "
  node -e \"const c = require('$work/config.json'); process.exit((c.services.web.volumes ?? []).some((v) => v.target === '/data' && v.type === 'volume') ? 0 : 1)\""

C up -d --build --wait > "$work/up.log" 2>&1 || { tail -40 "$work/up.log"; exit 1; }

echo "En HTTPS"
curl -sk -D "$work/page.h" -o /dev/null "https://localhost:$HTTPS_PORT/"
curl -sk -D "$work/api.h" -o /dev/null "https://localhost:$HTTPS_PORT/api/v1/health"
check "l'application répond en HTTPS" grep -q "^HTTP/2 200" "$work/page.h"
check "HSTS sur la page — vu : $(header strict-transport-security "$work/page.h")" grep -qi "^strict-transport-security: max-age=31536000" "$work/page.h"
check "HSTS aussi sur l'API" grep -qi "^strict-transport-security: max-age=31536000" "$work/api.h"
check "politique de contenu stricte : aucun script en ligne ni venu d'ailleurs (R-17)" sh -c "grep -i '^content-security-policy:' '$work/page.h' | grep -q \"script-src 'self';\""
check "aucun encadrement de l'application (frame-ancestors et X-Frame-Options)" sh -c "grep -i '^content-security-policy:' '$work/page.h' | grep -q \"frame-ancestors 'none'\" && grep -qi '^x-frame-options: DENY' '$work/page.h'"
check "nosniff sur la page et sur l'API" sh -c "grep -qi '^x-content-type-options: nosniff' '$work/page.h' && grep -qi '^x-content-type-options: nosniff' '$work/api.h'"
check "le serveur ne se nomme pas" sh -c "! grep -qi '^server:' '$work/page.h'"

echo "En clair"
curl -s -D "$work/http.h" -o /dev/null "http://localhost:$HTTP_PORT/"
check "le HTTP renvoie vers le HTTPS" sh -c "grep -q '^HTTP/1.1 308' '$work/http.h' && grep -qi '^location: https://' '$work/http.h'"

echo "La sonde de la base (R-9)"
ready=$(curl -sk -o /dev/null -w '%{http_code}' "https://localhost:$HTTPS_PORT/api/v1/health/ready")
check "elle n'est pas offerte à Internet — vu : $ready" test "$ready" = 404
check "et l'API est pourtant prête, vue de l'intérieur" C exec -T api node -e "fetch('http://localhost:3000/api/v1/health/ready').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

echo "Le certificat"
before=$(C exec -T web sh -c 'find /data/caddy/certificates -name "*.crt" -exec sha256sum {} + | sort')
C up -d --force-recreate --wait web > /dev/null 2>&1
after=$(C exec -T web sh -c 'find /data/caddy/certificates -name "*.crt" -exec sha256sum {} + | sort')
check "un certificat a été obtenu" test -n "$before"
check "il est gardé quand le conteneur est recréé" test "$before" = "$after"

echo "Les secrets"
for service in api migrate web; do
  image=$(C config --images "$service" 2> /dev/null | head -1)
  [ -n "$image" ] || image="${COMPOSE_PROJECT}-$service"
  docker image history --no-trunc "$image" > "$work/history.txt" 2>&1
  docker image inspect "$image" > "$work/inspect.json" 2>&1
  check "l'image $service ne porte aucun des secrets" sh -c "! grep -q -e '$DB_PASSWORD' -e '$APP_DB_PASSWORD' -e '$JWT_SECRET' '$work/history.txt' '$work/inspect.json'"
  check "l'image $service ne contient aucun fichier .env" sh -c "test -z \"\$(docker run --rm --entrypoint sh '$image' -c 'find / -xdev -name .env 2> /dev/null' 2> /dev/null)\""
done
C logs db > "$work/db.log" 2>&1
check "le journal de la base ne montre aucun mot de passe (R-10)" sh -c "! grep -q -e '$DB_PASSWORD' -e '$APP_DB_PASSWORD' '$work/db.log'"

echo "Changer un secret, sans toucher aux données"
# The stack now reads its secrets from a file, as on the server.
cat > "$work/test.env" <<EOF
DB_PASSWORD=$DB_PASSWORD
APP_DB_PASSWORD=$APP_DB_PASSWORD
JWT_SECRET=$JWT_SECRET
SITE_ADDRESS=localhost
EOF
chmod 600 "$work/test.env"
C exec -T db psql -U postgres -d yaar -q -c "INSERT INTO tenants (id, name, currency) VALUES ('00000000-0000-4000-8000-0000000000b1', 'Ferme Témoin', 'XOF')"
rotate() (
  unset DB_PASSWORD APP_DB_PASSWORD JWT_SECRET SITE_ADDRESS
  YAAR_ENV_FILE="$work/test.env" COMPOSE_FILE="$here/docker-compose.yml:$here/docker-compose.prod.yml:$work/ports.yml" "$here/rotate-secret.sh" "$1"
)
value() { sed -n "s/^$1=//p" "$work/test.env"; }
# Signs in as the API does: from another container, over the stack's internal network, with
# a password — exit 0 when the database accepts it. (Inside the database container, localhost
# is trusted without password by the image: no proof there.)
postgres_image=$(sed -n 's/^ *image: *//p' "$here/docker-compose.yml" | head -1)
signs_in() { docker run --rm --network "${COMPOSE_PROJECT}_data" -e PGPASSWORD="$2" "$postgres_image" psql -h db -U "$1" -d yaar -tAc 'SELECT 1' > /dev/null 2>&1; }
refused() { ! signs_in "$1" "$2"; }

old_app=$APP_DB_PASSWORD
rotate app > "$work/rotate.log" 2>&1 || cat "$work/rotate.log"
new_app=$(value APP_DB_PASSWORD)
check "le mot de passe de l'API change dans infra/.env" sh -c "[ -n '$new_app' ] && [ '$new_app' != '$old_app' ]"
check "la base refuse l'ancien mot de passe de l'API" refused yaar_app "$old_app"
check "elle accepte le nouveau" signs_in yaar_app "$new_app"
check "l'API a redémarré avec lui, prête" C exec -T api node -e "fetch('http://localhost:3000/api/v1/health/ready').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
check "la valeur n'est jamais affichée" sh -c "! grep -q '$new_app' '$work/rotate.log'"

old_owner=$DB_PASSWORD
rotate owner > "$work/rotate.log" 2>&1 || cat "$work/rotate.log"
new_owner=$(value DB_PASSWORD)
check "le mot de passe du propriétaire change, et les migrations repassent avec lui" sh -c "[ '$new_owner' != '$old_owner' ] && grep -q 'DB_PASSWORD changé' '$work/rotate.log'"
check "la base refuse l'ancien mot de passe du propriétaire" refused yaar "$old_owner"
check "elle accepte le nouveau" signs_in yaar "$new_owner"

old_jwt=$JWT_SECRET
rotate jwt > "$work/rotate.log" 2>&1 || cat "$work/rotate.log"
check "le secret des sessions change" sh -c "[ '$(value JWT_SECRET)' != '$old_jwt' ]"
check "le fichier des secrets reste lisible par son seul propriétaire" sh -c "ls -l '$work/test.env' | grep -q '^-rw-------'"
check "les données sont intactes" test "$(C exec -T db psql -U postgres -d yaar -tAc "SELECT name FROM tenants WHERE id = '00000000-0000-4000-8000-0000000000b1'")" = "Ferme Témoin"

if [ "$failures" -gt 0 ]; then
  echo "$failures vérification(s) en échec"
  exit 1
fi
echo "Tout est vérifié."
