# DIRECTOR'S CUT — 프로젝트 규약

NAN 2026 사전과제 제출용 웹 게임 (Phaser 4 + TypeScript + Vite).

- **스펙 SSOT:** `docs/specs/2026-08-09-ai-1983.md` (frozen, 2026-08-10 — sj-team 심의 인계). 구현 플랜: `docs/plans/2026-08-09-ai-1983.md`.
  - superseded: `nan2026-submission.md`(구 아레나) · `nan2026-mindread.md`(수읽기) · `nan2026-prison-escape.md`(감옥 스텔스). 셋 다 역사 자료로만 읽는다.
  - **게임의 유일한 성공 조건은 순서다** — 관찰 → (1.2초, 아무 일도 안 일어남) 예고 → 다음 웨이브에 마커 0.6초 먼저 → 스폰 → 확인. 말이 먼저, 그림이 나중.
- **감옥 스텔스 미커밋 작업분:** `salvage/prison-wip` 브랜치(`dbe3069`)에 보존. main에 병합하지 않는다.
- **계약 SSOT:** `src/contracts/directive.ts` — 디렉티브 타입·zod 스키마·예산표. engine은 이 타입만 알고 director/의 내부(LLM인지 뱅크인지)를 모른다.
  - ⚠️ `supabase/functions/director/index.ts`에 DIRECTIVE_JSON_SCHEMA의 수동 사본이 있다(별도 번들·타입체크 밖). `src/contracts/directive.ts` 변경 시 반드시 함께 갱신.
- **하네스:** `bash scripts/ai_harness.sh --fast`(tsc+vitest) / `--full`(+build) → `HARNESS RESULT: PASS|FAIL`.
- **배포:** main push 시 GitHub Actions가 자동으로 Pages 배포.
- **컷 순서(스코프 압박 시 이 순서로 축소):** 업그레이드 → splitter → mutation 축소(7→4종) → 사운드 → 디렉터 로그 패널. 디렉터 대사가 플레이를 읽는 순간은 사수.
