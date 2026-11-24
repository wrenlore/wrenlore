#!/usr/bin/env bash
set -Eeuo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

bash -n "$root/install.sh"

tmp_env="$(mktemp)"
trap 'rm -f "$tmp_env" /tmp/wrenlore-installer-test.out' EXIT
cat > "$tmp_env" <<ENV
APP_URL=http://localhost:3000
APP_SECRET=test-only-secret-at-least-32-chars
POSTGRES_DB=wrenlore
POSTGRES_USER=wrenlore
POSTGRES_PASSWORD=test-password
PORT=3000
WRENLORE_VERSION=test
ENV

docker compose -f "$root/deploy/compose.yaml" --env-file "$tmp_env" config --quiet

help="$("$root/install.sh" --help)"
grep -q -- "--install-docker" <<<"$help"
grep -q -- "--yes" <<<"$help"

if "$root/install.sh" --port invalid >/tmp/wrenlore-installer-test.out 2>&1; then
  echo "expected invalid port to fail" >&2
  exit 1
fi
grep -q "port must be a number" /tmp/wrenlore-installer-test.out

fake_bin="$(mktemp -d)"
trap 'rm -rf "$fake_bin"; rm -f "$tmp_env" /tmp/wrenlore-installer-test.out' EXIT
printf '#!/bin/sh\nexit 1\n' > "$fake_bin/docker"
chmod +x "$fake_bin/docker"
if PATH="$fake_bin:$PATH" "$root/install.sh" --yes >/tmp/wrenlore-installer-test.out 2>&1; then
  echo "expected unattended missing-Docker path to require explicit permission" >&2
  exit 1
fi
grep -q "Docker installation was not authorized" /tmp/wrenlore-installer-test.out

echo "installer contract checks passed"
