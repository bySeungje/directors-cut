# 구현 플랜 — 수읽기 (스펙 `docs/specs/nan2026-mindread.md` frozen 2026-08-08)

> 승인: 승제 "개발까지 스트레이트로" (2026-08-08) — 게이트 통합 승인.
> 원칙: 순수 로직(예측기·판돈)은 씬과 분리해 유닛으로 검증. 씬은 로직의 소비자.

## 단계

### P0 — 전작 철거 (첫 커밋)
- 삭제: `src/game/{entities,buffs,mutations,upgrades,habits,waveRunner}.ts`, `src/game/scenes/ArenaScene.ts`, `src/telemetry/collector.ts`, 전작 전용 tests 5파일.
- 유지: `juice.ts`(범용 이펙트만 남김), `sound.ts`, `scenes/{TitleScene,EndScene}.ts`(P2에서 수정), `ui/{interval,directorLog}.ts`(P2에서 수정), `director/*`(P2에서 교체), `contracts/directive.ts`(P2에서 재작성).
- 이 시점 tsc는 깨져도 된다 — P1 종료 커밋 전 PASS가 게이트.

### P1 — 코어 루프 (LLM 없이 완전한 게임)
| 파일 | 내용 |
|---|---|
| `src/game/predictor.ts` | 앙상블 이식(시뮬과 동일 로직+시드 주입 가능 rng) + 프리셋 6종 + 약속 창 + 반심기 트리거 + **근거 귀속**(최대 기여 예측기 + 템플릿 데이터) |
| `src/game/heist.ts` | 라운드 상태기: 관찰 1+본게임 11, 수익 수식, 정산, 몰수, 조기 종료(승리 확정·수학적 사망), 자동 정산, 리스타트 승계 훅 |
| `src/game/scenes/VaultScene.ts` | 금고 2개·클릭/←→·덫 상시 공개(니어미스/예측됨 스탬프+근거)·HUD(은행/미정산/스트릭/라운드/목표)·[정산] 버튼 |
| `tests/predictor.test.ts` | 게이트 1차 재현(시드 고정), 약속 창 준수, 반심기 발동, 귀속 불변식 |
| `tests/heist.test.ts` | 수익 수식(100·200·300…), 몰수, 조기 종료 경계, 자동 정산 |

### G2 — 판돈 시뮬 게이트 (`scripts/heist_sim.js`)
- 실게임 규칙 전체(약속 창·반심기·프리셋)로 정책군 승률 측정: 읽히는 무전략 / 역읽기(창 활용) / 랜덤 / 심기 정책군 3종.
- §3.2 4밴드 판정 → T·몰수율 확정 → 스펙 갱신. **미충족 시 여기서 멈추고 보고** (레버: T, 몰수율, 창 길이).

### P2 — 디렉터 층
| 파일 | 내용 |
|---|---|
| `src/contracts/directive.ts` | v2 재작성: readPatternId·read·taunt·strategy·baitDoor·intent + zod |
| `src/director/validator.ts` | 절단(길이)·정규화(baitDoor)·후보 검증(readPatternId)·구조 위반만 폴백 |
| `src/director/fallbackBank.ts` | 조립형: 엔진 최상위 후보 → read 템플릿 + 도발 뱅크 + BALANCED |
| `src/director/client.ts` | 페이로드 교체(이력+후보+예측기 성적), 타임아웃·캡 유지 |
| `src/director/report.ts` | 리포트 프롬프트 + 조립형 폴백(통계 기반) |
| `src/ui/interval.ts` | 읽기 세션 연출(타이핑 패널 재사용, 3택1 제거) |
| `src/game/scenes/{Title,End}Scene.ts` | 카피 교체·워밍업 유지 / 리포트·칭호·리스타트(승계) |
| `supabase/functions/director/index.ts` | 시스템 프롬프트·DIRECTIVE_JSON_SCHEMA 수동 사본·요청 필드 교체 (⚠️ CLAUDE.md 동기 규칙) |
| `tests/validator.test.ts` 등 | 검증기·폴백 조립기 |

### P3 — 폴리시·검증
- AI 눈 커서 추적, zzfx 4종 연결, 디렉터 로그 토글, 영상 가독(스탬프 크기·체류).
- `bash scripts/ai_harness.sh --full` PASS → 검증 리포트(`docs/verification/`) — 완료 기준 11항 대조.

## 배포 게이트 (8/9 오전)
1. 프록시 재배포: `supabase functions deploy director` — CLI 인증 가능 시 세션에서, 불가 시 승제.
2. `mindread` → main 머지 → Pages 자동 배포(구작 교체 — 승제 폐기 확정, 태그 `submission-v2` 보존).
3. 배포 후에만 LLM 정상 경로 검증 가능(CORS가 Pages 도메인 단일 허용) — 완료 기준 5·6·8 수동분은 이 뒤.

## 커밋 단위
P0 / P1(+tests) / G2(+스펙 갱신) / P2 / P3 / 검증 리포트 — 각 단계 하네스 `--fast` PASS 후 커밋 (P0 제외).
