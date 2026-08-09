# 스펙 — DIRECTOR'S CUT: AI 감옥 탈출 (현행 사양)

> **성격: 역기록 스펙.** 2026-08-08 밤~08-09 승제 지시 + 엑시(맥미니) 구현 주도로 게임이 세 차례 전환(수읽기 → 증거편집실 → 감옥 스텔스)된 뒤, 구현으로부터 역산해 현행 사양을 고정한 문서다. 커밋 `142554d` 기준. **새 세션은 이 문서에서 시작하라.**
> 구스펙 `nan2026-mindread.md`(수읽기)는 superseded — 전작 지식은 `docs/_hub/`.
> 마감: **2026-08-10 오전** (NAN 2026 사전과제 — 요구 5종은 `~/projects/claudedocs/research_NAN2026_공고분석_20260804.md`)

## 진행 상태

- [x] 게임 방향 확정: **AI 교도소장(DIRECTOR)이 탈출 습관을 학습해 다음 구역을 재설계하는 탑다운 스텔스** (2026-08-09, 승제·엑시)
- [x] 코어 시스템 구현 완료 (아래 §2~4) — 하네스 PASS (114+ 테스트)
- [x] 프록시(LLM) 감옥 페르소나 배포 — **배포는 맥북에서만 가능** (엑시 권한 없음, §5)
- [x] 검수 루프: 엑시 push → 맥북 pull → 하네스 → 스모크 → 보고 (08-08 밤~09 낮, 12커밋 전건 검수)
- [ ] **승제 실플레이 판정** (입구 체감·벽 은신 직관·순찰 적응 체감) → 프리즈 선언
- [ ] 산출물: 30~60초 영상 · 게임 소개 PDF · AI 활용 기술 문서 PDF
- [ ] main 최종 배포 확인 + 신청 폼 제출 (**승제 직접**, 8/10 오전) + 재직자 보증·약관 확인(승제)

## 1. 한 줄

**수감자 734가 되어, 나의 은신·돌파 습관을 학습하는 AI 교도소장의 감시망을 뚫고 7개 구역을 탈출하는 스텔스 액션.** 조작: WASD 이동 · Space 대시 · E/J 수동 EMP(소음 대가) · 시안색 출구 도달로 클리어.

## 2. 코어 시스템 (구현 완료 — 수치는 코드가 SSOT, 여기는 지도)

| 시스템 | 요지 | 코드 |
|---|---|---|
| 시야 콘 | 타입별(경비 215px/92° · 릴레이 135px/118° · 드론 275px/62° 회전 스캔), **벽 레이캐스트 차단**(은신 성립), 발각 시 빨강 | `ArenaScene.playerInVision/drawVisionCones` |
| 발각 게이지 | 노출 0.56/s 상승·비노출 0.38/s 감쇠·만충 시 피해+0.62 리셋. 센서는 0.42/s. **입장 유예 1.4초** | `updateStealthSystems` |
| 보안 무드 | clear→suspicious→searching→alert 상태기, 의심 임계 0.34/0.86, **최후 목격 지점 조사**(2.4s), **쓰러진 동료 발견**(190px), 경보망 전파(1.65s/소음 1.15s) | `SecurityMood`·`raiseSecurityNetwork` |
| 경비 AI | 순찰 루트 + 추격 + 벽걸림 우회(정체 감지 720/560ms). 이속 92/54/66 vs 플레이어 220 — "느리지만 눈이 무서운" 문법 | `entities.ts` |
| 맵 | 섹터별 벽 레이아웃 7종 + 프롭(감방·랙·크레이트·지게차 등) — **카메라·탐조등 프롭은 실제 센서** | `SECTOR_LAYOUTS`·`SECTOR_PROPS` |
| 구역 미션 | BLOCK 01~07 스토리·목표(탐조등 8초 체류=게이트, 나머지는 서사) + **출구 도달 = 클리어**(전멸 불요) | `SECTOR_STORIES`·`checkWaveClear` |
| 수동 EMP | E/J — 경비 무력화 가능하나 발각 +0.18 "NOISE SIGNATURE LOGGED" + 시체가 단서 | `Player.update` |
| **적응 순찰** | 다음 구역 순찰이 직전 런 텔레메트리로 휘어짐: 히트맵 핫스팟·지배 사분면 관통(벽붙기 ≥0.42·집중 ≥0.22 시 강화). **좌표는 전부 엔진 계산 — LLM은 수치 불가** | `adaptPatrolRouteToLastRun` |

## 3. AI 2층 구조 (전작 아키텍처 승계 — 기술 문서의 뼈대)

- **결정론 엔진**: 시야·발각·조사·적응 순찰 전부 로컬 즉답. LLM이 죽어도 게임 100% 성립.
- **LLM = 교도소장의 판단과 목소리**: Supabase Edge Function `director` (모델 claude-haiku-4-5, **감옥 관제 페르소나 — "수감자 734"**). 구역마다 디렉티브(구성·변주·카드·taunt·intent), 종료 시 WARDEN REPORT+칭호. 검증(zod)+폴백뱅크(전부 감옥 톤). 텔레메트리에 스텔스 필드(`visionExposureSec`·`exitReached`·`manualAttacks`) 추가됨 — **프록시 프롬프트에 이 필드 해설은 아직 없음(개선 후보)**.
- 습관 어휘: "숨는지 / 싸우는지 / 대시로 뚫는지 / 같은 길을 반복하는지".

## 4. 검증 상태 (맥북 검수 실측)

- ✅ 벽 은신·시야 차단, 미션 게이트(탐조등 AND 조건), 출구 클리어, 조립형 폴백, 프록시 라이브(페르소나 curl 확인), Pages 상대경로 에셋
- ✅ 무입력 즉사(실패 축 존재), 출구 직행 = SECTOR 1 기준 ~6초·HP -2 (공짜 아님, 습관 적응이 응징 전제)
- ⏳ **미검증**: SECTOR 3~7 통주행 밸런스(사람 손), 재도전 적응 체감, 60fps 실기 체감 — 봇 검증은 한계 (합성 포인터는 Phaser가 무시, 창 비활성 시 RAF 스로틀 → **Playwright 도입 사유**)

## 5. 운영 계약 (2머신 루프 — 틀리기 쉬운 것)

1. **프록시 배포는 맥북 전용**: 엑시가 `supabase/functions/director/index.ts`를 바꿔도 배포 못 한다. 계약(`src/contracts/directive.ts`)의 `DIRECTIVE_JSON_SCHEMA` 변경 시 프록시 수동 사본 동기 + `supabase functions deploy director --project-ref rffpffpjnggpqpvvzqsv --no-verify-jwt` (--no-verify-jwt 필수 — 빼면 401).
2. pull은 `--ff-only`, 검수는 `bash scripts/ai_harness.sh --fast` → 스모크 → 보고.
3. main push = Pages 자동 배포 (https://byseungje.github.io/directors-cut/).
4. 로컬 dev(포트 5201 관례)는 CORS로 LLM 차단 → 항상 폴백 경로 = 폴백 QA를 겸함. LLM 인게임 확인은 Pages에서.
5. **Playwright MCP 연결됨**(`.mcp.json`, project 스코프) — 자동 플레이 테스트는 격리 브라우저에서. dev QA 훅: `window.__game`(루프 수동 스텝), `window.__god`, `window.__skipWave()`.

## 6. 남은 일 (D-day 순서)

1. 승제 실플레이 → 조정 or **프리즈 선언**
2. 영상 30~60초 (아크: 발각→조사→은신 성공→적응된 순찰에 허 찔림→탈출) — 실플레이 촬영
3. 게임 소개 PDF + **AI 활용 기술 문서 PDF** (2층 구조 §3 + 권한 경계 + 하루 3회 피벗의 판단 기록 + 시뮬 게이트 방법론 — 수읽기 시절 자산도 "검증 과정"으로 인용 가치 있음, `docs/verification/`·`tests/heist_gate` 이력 참조)
4. 최종 배포 확인 + 제출 (승제)
