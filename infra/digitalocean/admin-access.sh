#!/usr/bin/env bash
# Host-only Superadmin recovery for the dedicated server. Run as root in the
# DigitalOcean Droplet console; root access on this server is the authority,
# the same trust the first-admin bootstrap and `operator:role reset-mfa` use.
#
#   bash /opt/gymmembership/releases/<current>/infra/digitalocean/admin-access.sh list
#   bash .../admin-access.sh create new-admin@example.com
#   bash .../admin-access.sh reset-password existing@example.com
#
# The new password is typed twice without echo and sent to the api container
# on stdin only: never in arguments, the environment or logs. Optional:
# ADMIN_ACCESS_NAME="Full Name" for create (default "Platform administrator").
set -euo pipefail
umask 077
ROOT="${ADMIN_ACCESS_ROOT:-/opt/gymmembership}"

usage() {
  echo "Usage: admin-access.sh <list|create|reset-password> [email]" >&2
  exit 2
}
fail() {
  echo "$1" >&2
  exit 1
}

action="${1:-}"
case "$action" in
  list) [ "$#" -eq 1 ] || usage ;;
  create | reset-password) [ "$#" -eq 2 ] || usage ;;
  *) usage ;;
esac
[ "$(id -u)" -eq 0 ] || fail "Run this as root on the trainsyou server."

# The current release, as recorded by host.py in release-state.json.
sha="$(python3 -c 'import json, re, sys
value = json.load(open(sys.argv[1])).get("current")
print(value if isinstance(value, str) and re.fullmatch(r"[0-9a-f]{40}", value) else "")' "$ROOT/release-state.json" 2>/dev/null || true)"
[ -n "$sha" ] || fail "No current release is recorded in $ROOT/release-state.json."
release="$ROOT/releases/$sha"
[ -f "$release/scripts/admin-access.ts" ] ||
  fail "The current release predates admin:access. Use the single command under 'Recover Superadmin access' in docs/DIGITALOCEAN_DEPLOYMENT.md."

# Same invocation as host.py compose(): reviewed runtime file, edge override,
# release tag, and no inherited application variables or DOCKER_HOST.
compose() {
  (cd "$release" && env -i PATH="$PATH" ${LANG:+LANG="$LANG"} RELEASE_TAG="$sha" \
    docker compose --project-name gymmembership --env-file "$ROOT/runtime.env" \
    -f "$release/compose.yaml" -f "$ROOT/edge.json" "$@")
}

if [ "$action" = list ]; then
  compose exec -T api npm run --silent admin:access -- list
  exit 0
fi

email="$2"
[[ "$email" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || fail "Enter a valid email address."
name="${ADMIN_ACCESS_NAME:-Platform administrator}"
[[ "$name" =~ ^[A-Za-z0-9\ .\'-]{2,100}$ ]] || fail "ADMIN_ACCESS_NAME may use letters, digits, spaces and . ' - (2-100)."

read -r -s -p "New password for $email (16-128 characters): " password
echo >&2
read -r -s -p "Repeat the new password: " repeat
echo >&2
[ "$password" = "$repeat" ] || { unset password repeat; fail "The passwords do not match; nothing changed."; }
unset repeat
[ "${#password}" -ge 16 ] && [ "${#password}" -le 128 ] ||
  { unset password; fail "The password must be 16-128 characters; nothing changed."; }

# printf is a shell builtin, so the password never appears in a process list.
script='umask 077; f="$(mktemp)"; cat > "$f"; ADMIN_ACCESS_PASSWORD_FILE="$f" npm run --silent admin:access -- "$1"; status=$?; rm -f "$f"; exit $status'
status=0
printf '%s' "$password" | compose exec -T -e "ADMIN_ACCESS_EMAIL=$email" -e "ADMIN_ACCESS_NAME=$name" \
  api sh -c "$script" admin-access "$action" || status=$?
unset password
exit "$status"
