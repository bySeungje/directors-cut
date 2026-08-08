#!/usr/bin/env bash
# 허브 근거 게이트 — SODA 지식허브 스펙(2026-08-06)의 검증 중 핵심 3항만 옮겼다.
# 도구 전체(hub_build.py)는 노드 16개 규모에 과투자라 만들지 않는다.
set -uo pipefail
cd "$(dirname "$0")/.."
NODES=docs/_hub/nodes
fail=0

# ① 근거 필수 — C·D 노드는 sources 또는 anchors를 가져야 한다
for f in "$NODES"/C-*.md "$NODES"/D-*.md; do
  [ -e "$f" ] || continue
  grep -qE '^(sources|anchors):' "$f" || { echo "FAIL 근거없음: $f"; fail=1; }
done

# ② 참조 무결성 — sources/contracts에 적힌 id가 실존해야 한다
for f in "$NODES"/*.md; do
  for ref in $(sed -n 's/^\(sources\|contracts\|supersedes\): \[\(.*\)\]/\2/p' "$f" | tr -d ' ' | tr ',' ' '); do
    [ -e "$NODES/$ref.md" ] || { echo "FAIL 참조깨짐: $f -> $ref"; fail=1; }
  done
done

# ③ 앵커 실존 — anchors가 가리키는 파일이 있어야 한다(썩은 규칙 감지)
for f in "$NODES"/*.md; do
  for a in $(sed -n '/^anchors:/,/^[a-z_]*:/p' "$f" | sed -n 's/^  - \(.*\)/\1/p'); do
    p="${a%%#*}"
    [ -e "$p" ] || { echo "FAIL 앵커없음: $f -> $p"; fail=1; }
  done
done

n=$(ls "$NODES"/*.md 2>/dev/null | wc -l | tr -d ' ')
[ "$fail" -eq 0 ] && echo "HUB CHECK: PASS ($n nodes)" || echo "HUB CHECK: FAIL"
exit $fail
