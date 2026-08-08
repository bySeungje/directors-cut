---
id: D-habits-five-to-three
type: decision
title: 습관 어휘 5종 → 3종 (ANCHOR·CORNER·DASH), HERD·WALL 폐기
date: 2026-08-08
decided_by: AI추천-PM승인
sources: [S-review-sim-20260808]
contracts: [C-metric-band-baserate, C-metric-owner-check, C-mutation-judge-collision]
status: active
---
**선택:** `ANCHOR`(한자리) · `CORNER`(한 구석) · `DASH`(대시 의존, **비율로** 판정) 셋만 남긴다. 선택은 초과율 비교가 아니라 **우선순위 고정**(ANCHOR → CORNER → DASH).

**기각 대안:** 5종 유지 + 상대 초과율로 선택(초안 rev1).

**이유:** 시뮬레이션에서 5종 전부 결함이 나왔다. `HERD`는 원리적으로 깰 수 없고 깨려는 시도가 지표를 반대로 움직인다([[C-metric-owner-check]]). `WALL`은 습관이 아니라 밴드 면적을 잰다([[C-metric-band-baserate]]). 초과율 비교는 격자 내포 때문에 성립하지 않는다([[C-nested-grid-no-excess-compare]]).

남은 셋은 **플레이어가 실제로 통제하고, 깨도 더 못하게 되지 않는** 것들이다. `ANCHOR`는 시뮬에서 의도대로 작동했다 — 움직이면 0.07~0.19, 주차하면 1.0.

⚠ **임계값은 아직 미확정이다.** rev1의 임계는 스펙 예시 숫자(0.55/0.31/6)에서 가져왔는데 그게 실측이 아니었다. 계측 훅으로 실제 런의 분포를 본 뒤에 정한다.
