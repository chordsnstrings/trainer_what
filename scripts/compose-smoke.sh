#!/usr/bin/env bash
# Disposable smoke of the deployed Compose topology: database, migrate, api, web,
# worker and a loopback HTTP edge standing in for Caddy. It follows the host
# controller's order (database, migrations, runtime role, application) with
# throwaway secrets. Never run it on a server: it deletes its own volumes.
set -euo pipefail

if [ "${CI:-}" != "true" ] && [ "${COMPOSE_SMOKE_LOCAL:-}" != "1" ]; then
  echo "Run this disposable smoke in CI, or set COMPOSE_SMOKE_LOCAL=1 on a workstation." >&2
  exit 2
fi
if [ -e /opt/gymmembership ]; then
  echo "Refusing to run beside a GymMembership deployment." >&2
  exit 2
fi

repo="$(cd "$(dirname "$0")/.." && pwd)"
project="${COMPOSE_SMOKE_PROJECT:-trainer-smoke}"
release="compose-smoke"
host="smoke.gymmembership.test"
port="${COMPOSE_SMOKE_EDGE_PORT:-8080}"
origin="http://$host:$port"
work="$(mktemp -d)"
chmod 700 "$work"

random_hex() { od -An -tx1 -N"$1" /dev/urandom | tr -d ' \n'; }
admin_password="$(random_hex 24)"
runtime_password="$(random_hex 24)"
umask 077
cat > "$work/runtime.env" <<EOF
POSTGRES_PASSWORD=$admin_password
MIGRATION_DATABASE_URL=postgres://trainer_migrations:$admin_password@database:5432/trainer
DATABASE_URL=postgres://trainer_service:$runtime_password@database:5432/trainer
SECURITY_ENCRYPTION_KEY=$(head -c 32 /dev/urandom | base64 | tr -d '\n')
INTERNAL_PROXY_SECRET=$(random_hex 48)
PUBLIC_APP_URL=$origin
EOF
umask 022
# Same edge shape as the host's edge.json, but plain HTTP on loopback.
cat > "$work/Caddyfile" <<EOF
$origin {
	header X-GymMembership-Release $release
	reverse_proxy web:3000
}
EOF
cat > "$work/edge.json" <<EOF
{"services": {"edge": {"image": "caddy:2.11.4-alpine", "restart": "unless-stopped",
  "ports": ["127.0.0.1:$port:$port"],
  "volumes": ["$work/Caddyfile:/etc/caddy/Caddyfile:ro"]}}}
EOF

# Like the host controller, ignore inherited application settings and engine overrides.
compose() {
  env -i PATH="$PATH" HOME="${HOME:-/root}" RELEASE_TAG="$release" \
    docker compose --project-name "$project" --env-file "$work/runtime.env" \
    -f "$repo/compose.yaml" -f "$work/edge.json" "$@"
}
psql_admin() { compose exec -T database psql -q -v ON_ERROR_STOP=1 -U trainer_migrations -d trainer "$@"; }

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    compose ps -a || true
    compose logs --no-color --tail 150 migrate api web worker edge || true
  fi
  compose down --volumes --remove-orphans --timeout 10 >/dev/null 2>&1 || true
  rm -rf "$work"
  exit "$status"
}
trap cleanup EXIT

compose config --quiet
if [ "${COMPOSE_SMOKE_SKIP_BUILD:-}" != "1" ]; then
  compose build migrate
fi
compose up -d --no-recreate --wait --wait-timeout 120 database
compose run --rm --no-deps migrate
{
  cat "$repo/infra/runtime-role.sql"
  printf "\nALTER ROLE trainer_service WITH LOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '%s';\n" "$runtime_password"
} | psql_admin >/dev/null
compose up -d --no-deps --force-recreate --wait --wait-timeout 180 api web worker edge

request() {
  local method="$1" path="$2"
  shift 2
  curl --silent --show-error --max-time 15 --noproxy '*' --resolve "$host:$port:127.0.0.1" \
    --request "$method" --dump-header "$work/headers" --output "$work/body" \
    --write-out '%{http_code}' "$@" "$origin$path"
}
check() {
  local name="$1" want="$2" fragment="$3" method="$4" path="$5" got
  shift 5
  got="$(request "$method" "$path" "$@")" || got="no response"
  if [ "$got" != "$want" ] || ! grep -qF -- "$fragment" "$work/body"; then
    echo "FAIL $name: expected HTTP $want with '$fragment', got $got" >&2
    head -c 400 "$work/body" >&2 || true
    echo >&2
    return 1
  fi
  echo "ok   $name (HTTP $got)"
}
edge_release() {
  if ! tr -d '\r' < "$work/headers" | grep -qix "x-gymmembership-release: $release"; then
    echo "FAIL $1: the edge did not add the release header" >&2
    return 1
  fi
}

ready=""
for attempt in $(seq 1 60); do
  if [ "$(request GET /api/v1/ready 2>/dev/null)" = "200" ] && grep -qF '"status":"ready"' "$work/body"; then
    ready=1
    break
  fi
  sleep 3
done
[ -n "$ready" ] || { echo "FAIL readiness through the edge" >&2; exit 1; }
edge_release "readiness through the edge"
echo "ok   readiness through edge, web proxy and API"

# Only a request signed by web with the shared secret is marked verifiedProxy.
check "signed host context" 200 '"verifiedProxy":true' GET /api/v1/public/host
grep -qF '"custom":false' "$work/body" || { echo "FAIL signed host context: platform host was not canonical" >&2; exit 1; }
check "home page" 200 '<html' GET /
edge_release "home page"
check "anonymous account request" 401 '"code":"AUTH_REQUIRED"' GET /api/v1/auth/account
check "cross-origin mutation" 403 '"code":"ORIGIN_REJECTED"' POST /api/v1/auth/login \
  --header "Origin: https://attacker.example" --header "Content-Type: application/json" \
  --data '{"email":"nobody@example.test","password":"not-a-real-password"}'
# Same-origin control: passes the origin gate and reads users as the runtime role.
check "same-origin unknown login" 401 '"code":"INVALID_LOGIN"' POST /api/v1/auth/login \
  --header "Origin: $origin" --header "Content-Type: application/json" \
  --data '{"email":"nobody@example.test","password":"not-a-real-password"}'

observed=0
for attempt in $(seq 1 40); do
  observed="$(psql_admin -tAc "SELECT count(*) FROM infrastructure_observations WHERE service='worker'")"
  [ "${observed:-0}" -ge 1 ] && break
  sleep 3
done
[ "${observed:-0}" -ge 1 ] || { echo "FAIL worker recorded no infrastructure cycle" >&2; exit 1; }
# A failed cycle means the runtime role cannot do the worker's database work.
failed="$(psql_admin -tAc "SELECT coalesce(max((measurements->'worker_failed_cycles'->>'value')::numeric),0) FROM infrastructure_observations WHERE service='worker'")"
[ "$failed" = "0" ] || { echo "FAIL worker cycles failed ($failed)" >&2; exit 1; }
echo "ok   worker recorded a successful infrastructure cycle"
sleep 15
for service in api web worker edge; do
  id="$(compose ps -q "$service")"
  state="$(docker inspect --format '{{.State.Running}} {{.RestartCount}}' "$id")"
  if [ "$state" != "true 0" ]; then
    echo "FAIL $service is not running steadily (running, restarts: $state)" >&2
    exit 1
  fi
done
echo "ok   api, web, worker and edge running without restarts"
