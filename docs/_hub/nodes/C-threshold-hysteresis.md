---
id: C-threshold-hysteresis
type: contract
title: 반올림 때문에 임계에 걸친 값은 행동 없이 뒤집힌다
anchors:
  - src/telemetry/collector.ts#norm
---
임계 판정에는 히스테리시스를 둔다 — 적중은 `값 ≥ 임계`, 반대 판정은 `값 < 임계 × 0.85`, 사이는 무효.

`finish()`가 소수 2자리로 반올림하므로 임계에 걸친 값은 플레이어가 아무것도 바꾸지 않아도 판정이 바뀐다.

어기면: 완료 기준("습관을 바꾸면 판정이 뒤집힌다")의 정반대가 된다 — 안 바꿔도 뒤집힌다.
