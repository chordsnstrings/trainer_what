#!/bin/sh
# CI only: put the faster Ubuntu mirror first before any apt-get or
# `playwright install --with-deps`. The runners' Azure mirror is sometimes
# slow (about 40 KB/s on 22 and 26 October 2026), and jobs were cancelled at
# their time limit while downloading packages, before any test ran. Each
# mirror gets 8 seconds on the same 13.6 MB package from the frozen noble
# pool; the faster one goes first in the runner's apt mirror list.
set -u
list=/etc/apt/apt-mirrors.txt
azure=http://azure.archive.ubuntu.com/ubuntu/
archive=http://archive.ubuntu.com/ubuntu/
probe=pool/universe/f/flite/libflite1_2.2-6build3_amd64.deb
if ! grep -rqs "mirror+file:$list" /etc/apt/sources.list /etc/apt/sources.list.d; then
  echo "apt does not read $list; mirrors left as they are"
  exit 0
fi
speed() {
  curl -s -o /dev/null --max-time 8 -w '%{speed_download}' "$1$probe" | awk '{ printf "%d", $1 }'
}
a=$(speed "$azure")
a=${a:-0}
echo "Azure mirror: $((a / 1024)) KB/s"
# Fast enough (2 MB/s and up): keep the runner's own list.
[ "$a" -ge 2097152 ] && exit 0
b=$(speed "$archive")
b=${b:-0}
echo "archive.ubuntu.com: $((b / 1024)) KB/s"
[ "$b" -gt "$a" ] || exit 0
printf '%s\tpriority:1\n%s\tpriority:2\nhttp://security.ubuntu.com/ubuntu/\tpriority:3\n' "$archive" "$azure" | sudo tee "$list" >/dev/null
echo "::notice::Slow Azure Ubuntu mirror; apt uses archive.ubuntu.com first"
