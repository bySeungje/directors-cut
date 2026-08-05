#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/.."
MODE="${1:---fast}"
fail() { echo "HARNESS RESULT: FAIL"; exit 1; }
case "$MODE" in
  --help) echo "usage: ai_harness.sh [--fast|--full]"; exit 0 ;;
  --fast) npx tsc --noEmit || fail; npx vitest run --passWithNoTests || fail ;;
  --full) npx tsc --noEmit || fail; npx vitest run --passWithNoTests || fail; npx vite build || fail ;;
  *) fail ;;
esac
echo "HARNESS RESULT: PASS"
