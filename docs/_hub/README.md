# 지식 허브 — 진입점

> 설계 차용: SODA `docs/specs/2026-08-06-knowledge-hub-graph-redesign.md` (frozen, 검증 완료 2026-08-07).
> 이 프로젝트 규모(노드 16개·마감 2일)에 맞춰 **축소 적용**했다 — §축소 적용 참조.

```
[오픈북]  docs/verification/ · docs/specs/ · docs/plans/ — 원본·실측·근거. 허브 구축 시에만 연다
   ↓ 추출·등록
[허브]    docs/_hub/nodes/ — 결정(D)·근거(S)·계약(C) 노드. 1노드 1사실
   ↓ 단일 창구
[에이전트] 허브 + 코드(grep)만 본다
```

## 무엇이 노드가 되나

| 출처 | 노드화 |
|---|---|
| 코드에서 파생 가능 (상수 위치·호출 관계·소비처) | ❌ 쓰면 썩는다. grep이 항상 최신 |
| git·스펙에서 파생 가능 (진행 상황·완료 연혁) | ❌ SSOT가 따로 있다 |
| **어디에도 없는 것** — 왜 이 값인가(S) · 왜 이 방향인가(D) · **왜 이러면 안 되나(C)** | ✅ 이것만 |

판정 기준: **"다음 세션이 틀릴 만한 것"만.**

작업 방식·PM 선호는 허브가 아니다 → auto-memory. 승제의 선택 함수도 아니다 → 세컨드 브레인 vault(링크만, 사본 금지).

## 계약 (C) — 왜 이러면 안 되나

지표를 만들기 전에 **C-metric-\* 다섯 개를 먼저 읽는다.** 습관 지표 5종을 만들었다가 4종이 플레이어가 아니라 아레나 기하와 웨이브 길이를 재고 있던 사고에서 나왔다.

| 노드 | 한 줄 |
|---|---|
| `C-metric-band-baserate` | 영역 지표는 밴드 면적이 곧 기저율 (벽 밴드 = 아레나의 37.5%) |
| `C-mutation-judge-collision` | 변주 경계와 판정 경계가 같은 선이면 판정이 조작된다 (LAVA와 사분면이 둘 다 `x<w/2`) |
| `C-nested-grid-no-excess-compare` | 지표가 포함 관계면 초과율 비교가 성립 안 한다 (8×6이 사분면에 4×3으로) |
| `C-duration-normalized-metrics` | 웨이브 길이로 나눈 값은 행동이 아니라 길이를 잰다 |
| `C-metric-owner-check` | 지표가 플레이어를 재는지 디렉터를 재는지 |
| `C-zero-is-absence` | 0은 낮음이 아니라 데이터 없음일 수 있다 |
| `C-threshold-hysteresis` | 반올림 때문에 임계에 걸친 값은 행동 없이 뒤집힌다 |
| `C-phaser-time-now-unscaled` | `scene.time.now`는 timeScale 무관 — 배속을 걸면 밸런스가 깨진다 |
| `C-arcade-timescale-inverse` | Arcade `world.timeScale`은 역수 — 0.4는 2.5배 가속 |
| `C-budget-symmetric` | 엔진의 LLM 교정은 양방향으로. 거부는 최후 수단 |
| **`C-player-needs-a-failure-axis`** | **난이도는 "플레이어가 못 하는 것"에서 나온다. 실패 축이 없으면 물량은 무의미** |
| **`C-speed-ratio-decides-threat`** | **이속·탄속은 절대값이 아니라 플레이어 대비 비율이 위협을 결정한다** |

## 결정 (D) — 왜 이 방향인가

| 노드 | 한 줄 |
|---|---|
| `D-dopamine-axis-read-the-ai` | 도파민 축은 "내가 AI를 읽었다". 관전형 폐기, 조작 유지 |
| `D-settlement-in-arena` | 정산은 인터벌이 아니라 아레나 안 — 살아 있는 미터 + 처치 스탬프 |
| `D-habits-five-to-three` | 습관 5종 → 3종. 임계는 계측 후 확정 |
| `D-budget-overflow-trim` | 예산 초과는 거부가 아니라 축소 |
| **`D-abandon-directors-cut`** | **게임플레이 개선 중단, 새 프로젝트로 전환 (2026-08-08 PM 결정)** |

## 근거 (S) — 원본이 어디 있나

| 노드 | 실물 |
|---|---|
| `S-budget-curve-20260806` | `docs/verification/2026-08-06-budget-curve.md` |
| `S-review-sim-20260808` | `docs/verification/2026-08-08-telemetry-traps.md` (시뮬은 `scripts/habit_sim.ts`로 재현 가능) |
| `S-easy-postmortem-20260808` | `docs/verification/2026-08-08-why-it-stayed-easy.md` — **종료 기록** |

## 이 프로젝트를 떠나는 사람이 읽을 것

게임플레이 개선은 2026-08-08에 중단됐다(`D-abandon-directors-cut`). **왜 어렵게 만들 수 없었는지**가
가장 가져갈 만한 지식이다 — `C-player-needs-a-failure-axis`와 `C-speed-ratio-decides-threat` 두 개,
그리고 그 근거인 종료 기록.

**살아남는 자산은 게임이 아니라 구조다:** 디렉터 아키텍처(어휘는 LLM·집행은 결정론), 예산·폴백
이중 검증, 지표를 만들 때의 함정 10종, 그리고 이 허브 자체.

## 검증

```
bash scripts/hub_check.sh
```

SODA 스펙의 검증 7항 중 **핵심 3항**만 옮겼다 — ① C·D 노드의 근거 필수(`sources` 또는 `anchors`, 없으면 FAIL) ② 참조 무결성 ③ 앵커 파일 실존(썩은 규칙 감지). 실제로 이 게이트가 도입 즉시 `D-budget-overflow-trim`의 근거 누락을 잡았다.

## 축소 적용 — SODA 스펙 대비 의도적 편차

| 스펙 | 이 프로젝트 | 사유 |
|---|---|---|
| `hub_build.py` 생성층(화면별·연혁·미결·그래프) | **없음.** 이 README가 손유지 색인 | 노드 16개에 생성기는 과투자. 스펙 자신의 "안 읽힐 노드를 미리 만들지 않는다" 정신 |
| `sha256` 원본 정합 검증 | **없음** | 오픈북이 전부 repo 안 텍스트라 git이 변조를 잡는다. SODA는 외부 png·eml이라 필요했다 |
| 검증 7항 | 3항 | 위 |
| 트랙 단위 배치 이관 | 1회 | 이관 대상이 문서 1개 |

**손유지 색인은 스펙의 "손유지 제로" 원칙 위반이다.** 노드가 30개를 넘거나 본선(9/4~9/6)에 들어가면 생성기로 교체한다.
