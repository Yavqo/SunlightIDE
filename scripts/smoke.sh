#!/usr/bin/env bash
# Runs the in-app smoke tests against a throwaway copy of the demo project and a throwaway profile.
# Usage: npm run smoke
set -euo pipefail
# Commits made by the tests need an identity, whatever the machine's git config says.
export GIT_AUTHOR_NAME=Tester GIT_AUTHOR_EMAIL=tester@example.com GIT_COMMITTER_NAME=Tester GIT_COMMITTER_EMAIL=tester@example.com
cd "$(dirname "$0")/.."
status=0
for script in basic ui tags multi git ext language updates split; do
  tmp="$(mktemp -d)"
  cp -R test/fixtures/demo "$tmp/demo"
  mkdir -p "$tmp/profile"
  cp -R test/fixtures/ext "$tmp/ext"
  if [ -f "test/smoke/$script.setup.sh" ]; then bash "test/smoke/$script.setup.sh" "$tmp/demo"; fi
  echo "== smoke: $script"
  out="$(SUNLIGHT_USER_DATA="$tmp/profile" SUNLIGHT_DEMO="$tmp/demo" SUNLIGHT_EXT_FIXTURES="$tmp/ext" SUNLIGHT_SMOKE="test/smoke/$script.js" npx electron . 2>&1 | grep -E 'SMOKE_' || true)"
  echo "$out"
  if ! grep -q 'SMOKE_RESULT' <<<"$out" || ! grep -q '"failed":\[\]' <<<"$out" || ! grep -q '"errors":\[\]' <<<"$out"; then status=1; fi
  rm -rf "$tmp"
done
exit $status
