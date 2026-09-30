#!/bin/sh
# Read-only deploy watch: polls the public readiness endpoint until the live
# release header shows the expected commit (prefix match) or the time runs out.
# Usage: scripts/watch-release.sh <commit-sha> [minutes=45] [url]
set -u
want="${1:?usage: scripts/watch-release.sh <commit-sha> [minutes] [url]}"
minutes="${2:-45}"
url="${3:-https://trainsyou.com/api/v1/ready}"
end=$(( $(date +%s) + minutes * 60 ))
while [ "$(date +%s)" -lt "$end" ]; do
  headers=$(curl -s -o /dev/null -D - --max-time 20 "$url" | tr -d '\r')
  code=$(printf '%s\n' "$headers" | awk 'NR==1{print $2}')
  release=$(printf '%s\n' "$headers" | awk 'tolower($1)=="x-gymmembership-release:"{print $2}')
  echo "$(date -u +%H:%M:%S) status=${code:-none} release=${release:-none}"
  case "$release" in "$want"*) [ "$code" = "200" ] && { echo "LIVE $release"; exit 0; } ;; esac
  sleep 60
done
echo "TIMEOUT waiting for $want"; exit 1
