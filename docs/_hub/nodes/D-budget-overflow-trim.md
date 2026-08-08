---
id: D-budget-overflow-trim
type: decision
title: 예산 초과를 거부 대신 축소 — 폴백으로 떨어져 LLM 대사를 잃던 문제
date: 2026-08-08
decided_by: AI추천-PM승인
contracts: [C-budget-symmetric]
anchors:
  - src/director/validator.ts#trimToBudgetCap
  - tests/validator.test.ts
status: active
---
**선택:** `validateDirective`가 예산 초과 디렉티브를 거부하지 않고 `trimToBudgetCap`으로 축소한다(`64e022e`). 라운드로빈으로 1기씩 덜어 비율을 유지하고, 그래도 넘으면 단가가 비싼 항목부터 통째로 뺀다.

**기각 대안:** 거부 유지(기존) — 예산 규칙을 "위반은 곧 폴백"으로 단순하게 두는 쪽.

**이유:** 거부하면 폴백 뱅크로 떨어지는데 뱅크 대사는 습관을 지목하지 않는 고정 문자열이라 심사자가 만나는 것이 '나를 읽는 디렉터'가 아니라 '대사 읽는 NPC'가 된다. 축소하면 예산 상한은 그대로 지켜지면서 LLM이 쓴 taunt·intent·변주·강화·봉인이 전부 살아남는다 — **안전성은 동일하고 디렉터의 존재감만 커진다.**

규약 변경이라 "초과 = 거부"를 단언하던 기존 테스트 3건을 축소 단언으로 갱신했다. 방어적 상한 검사는 남겨, 계약이 바뀌어 축소 전제가 깨지면 조용히 상한을 넘기느니 폴백으로 가게 한다.
