#!/usr/bin/env bash
set -Eeuo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

bash -n "$root/install.sh"
docker compose version >/dev/null
help="$(bash "$root/install.sh" --help)"
if grep -q -- "--install-docker" <<<"$help"; then
  echo "installer must not offer Docker installation" >&2
  exit 1
fi
if grep -q -- "--yes" <<<"$help"; then
  echo "installer must not expose a meaningless approval flag" >&2
  exit 1
fi

# Real Compose parser, mocked daemon: no image pulls or live Docker mutations.
python3 "$root/scripts/deploy/test-installer.py" "$@"
