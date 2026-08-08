---
id: C-mutation-judge-collision
type: contract
title: 변주 경계와 판정 경계가 같은 선이면 판정이 조작된다
anchors:
  - src/game/mutations.ts#applyLava
  - src/telemetry/collector.ts#quad
---
새 지표를 만들면 **변주 8종 각각과 교차 검사**한다. 변주가 지표를 강제하는 조합은 **판정 시점에 무효 처리**한다 — 예측 시점엔 거를 수 없다(변주는 예측 뒤에 정해진다).

`LAVA_LEFT` 경계 `x < w/2` = 사분면 판정 경계. **같은 선이다.** 용암을 피하면 오른쪽 절반(=두 사분면)에 갇히므로 비둘기집 원리로 `max(quadrantTime) ≥ 0.50`이 **확정**된다. 임계 0.40을 무조건 넘는다.

같은 계열: `SHRINK_ARENA` 안전지대 `x∈[115,845]` ∩ 벽 밴드 `x<80 ∪ x>880` = **좌우 모두 공집합**(위아래 3.2px, 플레이어 반지름 11px). 축소 웨이브에서 벽 지표는 무조건 0.

어기면: 디렉터가 자기 손으로 판정을 정한다. "AI가 나를 읽었다"가 "AI가 조작질한다"가 된다.
