# DIRECTOR'S CUT — 프로젝트 규약

NAN 2026 사전과제 제출용 웹 게임 (Phaser 3 + TypeScript + Vite).

- **스펙 SSOT:** `docs/specs/nan2026-submission.md` (frozen). 구현 플랜: `docs/plans/nan2026-submission.md`.
- **계약 SSOT:** `src/contracts/directive.ts` — 디렉티브 타입·zod 스키마·예산표. engine은 이 타입만 알고 director/의 내부(LLM인지 뱅크인지)를 모른다.
  - ⚠️ `supabase/functions/director/index.ts`에 DIRECTIVE_JSON_SCHEMA의 수동 사본이 있다(별도 번들·타입체크 밖). `src/contracts/directive.ts` 변경 시 반드시 함께 갱신.
- **하네스:** `bash scripts/ai_harness.sh --fast`(tsc+vitest) / `--full`(+build) → `HARNESS RESULT: PASS|FAIL`.
- **배포:** main push 시 GitHub Actions가 자동으로 Pages 배포.
- **컷 순서(스코프 압박 시 이 순서로 축소):** 업그레이드 → splitter → mutation 축소(7→4종) → 사운드 → 디렉터 로그 패널. 디렉터 대사가 플레이를 읽는 순간은 사수.
