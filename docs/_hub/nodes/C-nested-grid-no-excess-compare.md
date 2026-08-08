---
id: C-nested-grid-no-excess-compare
type: contract
title: 지표가 포함 관계면 초과율 비교가 성립하지 않는다
anchors:
  - src/telemetry/collector.ts#HOT_COLS
---
지표들이 포함 관계인지 확인한다. 포함 관계면 **초과율 비교 대신 우선순위를 고정**한다 — 더 정확하고 싸다.

히트맵 `HOT_COLS=8 · HOT_ROWS=6`, 사분면은 절반 → 사분면 하나 = 정확히 **4×3=12셀**. 셀이 빈틈없이 내포되므로 `hotspotConcentration ≤ max(quadrantTime)`가 **항상** 성립.

따라서 초과율로 고르면 `ANCHOR`가 `CORNER`를 이기려면 `hotspot/maxQuad > 0.875`여야 한다 — 사실상 불가능. 실측(구석 캠핑): hotspot 0.49 / maxQuad 1.00 → CORNER 승.

어기면: 한 지표가 원리적으로 선택되지 않는 죽은 어휘가 된다.
