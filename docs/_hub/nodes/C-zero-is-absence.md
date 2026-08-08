---
id: C-zero-is-absence
type: contract
title: 0은 "낮음"이 아니라 "데이터 없음"일 수 있다
anchors:
  - src/telemetry/collector.ts#finish
---
하한 방향 임계(`값 ≤ 임계`)를 쓰는 지표는 `> 0` 조건을 함께 건다.

`clusterRatio`는 2기 이상이 동시에 살아 있던 적이 없으면 `clusterTime===0`이라 `0`을 반환한다. `0 ≤ 0.25`가 참이므로 **데이터 없음이 "적중"으로 채점된다.** 사망 경로 스냅샷에서 실제로 도달 가능하다.

어기면: 측정하지 못한 웨이브가 디렉터의 점수가 된다.
