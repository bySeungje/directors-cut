# DIRECTOR'S CUT — 구현 플랜 (NAN 2026 사전과제)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) 구문으로 추적한다.

**Goal:** 플레이어를 읽고 판을 다시 짜는 AI 디렉터와 싸우는 웹 서바이벌 게임을 8/10 제출 가능 상태로 완성한다 (Pages 배포 + 영상 + 문서).

**Architecture:** Phaser 4 아케이드 엔진이 "디렉티브"(제한된 JSON 어휘)만 소비하는 결정론 실행기. LLM(디렉터)은 Supabase Edge Function 프록시 뒤에서 디렉티브를 생성하고, 검증 실패·지연 시 사전 제작 뱅크로 무음 폴백. **폴백 뱅크를 먼저 만들어 LLM 없이도 게임이 완주 가능하게 한 뒤** LLM을 얹는다.

**Tech Stack:** Phaser 4 + TypeScript + Vite / vitest / zod / Supabase Edge Function (Deno) + `@anthropic-ai/sdk` / GitHub Actions → Pages / zzfx(사운드)

## Global Constraints (스펙에서 발췌 — 모든 태스크에 적용)

- 디렉터 계약은 스펙 3.4절이 SSOT: 플레이 로그 입력, 디렉티브 출력, 포인트 예산 = f(웨이브), 동일 mutation 2연속 금지, 4초 타임아웃 폴백.
- 프론트 코드에 API 키·비밀 금지. 키는 Edge Function 환경변수만.
- 외부 에셋 0개 (셰이프 렌더링 + zzfx 생성음만). 라이선스 리스크 0 유지.
- 비주얼: 다크 배경(#0a0a0f), 무채색 엔티티, 레드(#ff2d2d)는 디렉터 요소 전용. UI 한국어.
- LLM 모델: `claude-haiku-4-5` (스펙 확정 — 런타임 지연 요구. structured outputs 지원 확인됨).
- 커밋 단위 유지 (사전과제 요구: 커밋 기록). 커밋 메시지 한국어/영어 무관, Co-Authored-By 트레일러 유지.
- 컷 순서(스코프 압박 시): 업그레이드 → splitter → mutation 축소 → 사운드 → 로그 패널. 디렉터 대사가 플레이를 읽는 순간은 사수.

## 파일 구조 (전체 지도)

```
src/
├── main.ts                     # Phaser 부트 + 씬 등록
├── contracts/directive.ts      # 타입 + zod 스키마 + 예산표 + JSON Schema (계약 — Task 2)
├── director/
│   ├── validator.ts            # 스키마·예산·mutation 규칙 검증 (Task 2)
│   ├── fallbackBank.ts         # 오프닝 + 웨이브별 3종 디렉티브 뱅크 (Task 3)
│   ├── client.ts               # 프록시 호출·타임아웃·세션 캡·폴백 선택 (Task 7)
│   └── report.ts               # 엔드게임 리포트 호출 + 정적 폴백 (Task 9)
├── telemetry/collector.ts      # 웨이브별 플레이 로그 집계 (Task 4)
├── game/
│   ├── scenes/ArenaScene.ts    # 메인 게임 씬 (Task 5)
│   ├── scenes/TitleScene.ts    # 타이틀 (Task 5)
│   ├── scenes/EndScene.ts      # 승패 + 리포트 (Task 9)
│   ├── entities.ts             # Player·Enemy·Bullet (Task 5)
│   ├── waveRunner.ts           # 디렉티브 → 스폰·mutation 실행 (Task 6)
│   ├── mutations.ts            # 변주 효과 구현 (Task 6)
│   └── upgrades.ts             # 업그레이드 정의·적용 (Task 8)
├── ui/
│   ├── interval.ts             # 디렉터 인터벌 연출 + 3택1 (Task 8)
│   └── directorLog.ts          # 디렉티브 JSON 패널 (Task 8, 컷 가능)
supabase/functions/director/index.ts   # 프록시 (Task 7)
tests/*.test.ts                 # validator·budget·fallback·telemetry (vitest)
scripts/ai_harness.sh           # --fast: tsc+vitest / --full: +build (Task 1)
.github/workflows/deploy.yml    # main push → Pages (Task 1)
```

인터페이스 계약: `contracts/directive.ts`의 타입이 모든 모듈의 유일한 공유 지점. engine(waveRunner)은 `Directive`만 알고 director/의 내부(LLM인지 뱅크인지)를 모른다.

---

### Task 1: 스캐폴딩 — 빌드·하네스·배포 라인

**Files:** Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.ts`, `scripts/ai_harness.sh`, `.github/workflows/deploy.yml`, `CLAUDE.md`, `.gitignore`

**Interfaces:** Produces: `npm run dev|build|test`, `bash scripts/ai_harness.sh --fast` → `HARNESS RESULT: PASS|FAIL`, main push 시 Pages 자동 배포.

- [ ] **Step 1: 프로젝트 초기화**

```bash
cd ~/projects/directors-cut
npm init -y && npm i phaser zod && npm i -D typescript vite vitest @types/node
```

- [ ] **Step 2: 설정 파일 작성**

`vite.config.ts`:
```ts
import { defineConfig } from 'vite';
export default defineConfig({
  base: '/directors-cut/',
  build: { target: 'es2020' },
});
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020", "module": "ESNext", "moduleResolution": "bundler",
    "strict": true, "noEmit": true, "skipLibCheck": true,
    "types": ["vite/client"]
  },
  "include": ["src", "tests"]
}
```

`index.html` (루트):
```html
<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>DIRECTOR'S CUT</title>
  <style>html,body{margin:0;background:#0a0a0f;height:100%;display:grid;place-items:center}</style>
</head>
<body><script type="module" src="/src/main.ts"></script></body>
</html>
```

`src/main.ts` (씬은 이후 태스크에서 추가 — 지금은 빈 씬으로 부팅 확인):
```ts
import Phaser from 'phaser';

new Phaser.Game({
  type: Phaser.AUTO,
  width: 960,
  height: 640,
  backgroundColor: '#0a0a0f',
  physics: { default: 'arcade' },
  scene: [],
});
```

`package.json`의 scripts:
```json
{
  "dev": "vite",
  "build": "tsc && vite build",
  "test": "vitest run"
}
```

`.gitignore`: `node_modules/`, `dist/`, `.env`, `.DS_Store`

- [ ] **Step 3: 하네스 작성** (`scripts/ai_harness.sh`, HARNESS_CONTRACT 규약)

```bash
#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/.."
MODE="${1:---fast}"
fail() { echo "HARNESS RESULT: FAIL"; exit 1; }
case "$MODE" in
  --help) echo "usage: ai_harness.sh [--fast|--full]"; exit 0 ;;
  --fast) npx tsc --noEmit || fail; npx vitest run || fail ;;
  --full) npx tsc --noEmit || fail; npx vitest run || fail; npx vite build || fail ;;
  *) fail ;;
esac
echo "HARNESS RESULT: PASS"
```

- [ ] **Step 4: Pages 배포 워크플로** (`.github/workflows/deploy.yml`)

*(개정 2026-08-05: 초안은 `{ }` 축약 표기 안에 `${{ }}` 표현식을 따옴서 없이 넣어 YAML 파싱이 깨졌다 — Actions가 0초 만에 "workflow file issue"로 실패. block style로 전면 교체하고 실배포로 검증했다. Pages는 첫 배포 전 `gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow`로 활성화해야 한다.)*

```yaml
name: deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run build
        env:
          VITE_DIRECTOR_URL: ${{ vars.VITE_DIRECTOR_URL }}
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 5: CLAUDE.md 작성** — 프로젝트 규약 요약 (스펙 위치, 하네스 사용법, 계약 SSOT가 `contracts/directive.ts`라는 것, 컷 순서). 10줄 내외.

- [ ] **Step 6: 검증**

Run: `bash scripts/ai_harness.sh --fast` → `HARNESS RESULT: PASS` (테스트 0개 통과 허용: vitest `--passWithNoTests` 필요 시 스크립트에 추가)
Run: `npm run dev` → 브라우저에서 검은 캔버스 표시 확인

- [ ] **Step 7: repo 공개 + push**

```bash
git add -A && git commit -m "chore: 스캐폴딩 — vite+phaser+ts, 하네스, pages 배포

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
gh repo create bySeungje/directors-cut --public --source . --remote origin --push
```

Actions 탭에서 deploy 성공 + `https://byseungje.github.io/directors-cut/` 로드 확인. (Settings→Pages source가 GitHub Actions인지 확인)

---

### Task 2: 계약 + 검증기 — `contracts/directive.ts`, `director/validator.ts`

**Files:** Create: `src/contracts/directive.ts`, `src/director/validator.ts`, Test: `tests/validator.test.ts`

**Interfaces:** Produces (이후 모든 태스크가 소비):
- `type EnemyType = 'chaser'|'shooter'|'splitter'`, `type SpawnPattern = 'N'|'S'|'E'|'W'|'RING'|'PINCER'|'BEHIND'`, `type Mutation = 'NONE'|'LAVA_LEFT'|'LAVA_RIGHT'|'FOG'|'SPEED_SURGE'|'SHRINK_ARENA'|'SPAWN_STORM'`
- `interface Directive { composition: {type: EnemyType; count: number; spawn: SpawnPattern; elite: boolean}[]; mutation: Mutation; taunt: string; intent: string }`
- `interface WaveLog` (스펙 3.4 입력 스키마 그대로)
- `budgetFor(wave: number): number`, `costOf(comp: Directive['composition'][0]): number`
- `validateDirective(raw: unknown, wave: number, prevMutation: Mutation): Directive | null` — null이면 폴백 사용
- `DIRECTIVE_JSON_SCHEMA` — 프록시가 API structured output에 쓰는 JSON Schema 객체

- [ ] **Step 1: 실패하는 테스트 작성** (`tests/validator.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { validateDirective, budgetFor, costOf } from '../src/director/validator';

const ok = {
  composition: [{ type: 'chaser', count: 8, spawn: 'N', elite: false }],
  mutation: 'FOG', taunt: '벽에 붙는 습관, 봤다.', intent: '벽면 회피 차단',
};

describe('validateDirective', () => {
  it('정상 디렉티브 통과', () => {
    expect(validateDirective(ok, 3, 'NONE')).not.toBeNull();
  });
  it('enum 밖 값 거부', () => {
    expect(validateDirective({ ...ok, mutation: 'EARTHQUAKE' }, 3, 'NONE')).toBeNull();
  });
  it('taunt 60자 초과 거부', () => {
    expect(validateDirective({ ...ok, taunt: '가'.repeat(61) }, 3, 'NONE')).toBeNull();
  });
  it('예산 초과 거부: 웨이브3 상한을 넘는 엘리트 물량', () => {
    const over = { ...ok, composition: [{ type: 'splitter', count: 30, spawn: 'RING', elite: true }] };
    expect(validateDirective(over, 3, 'NONE')).toBeNull();
  });
  it('동일 mutation 2연속이면 mutation을 NONE으로 강제 교체(거부 아님)', () => {
    const v = validateDirective(ok, 3, 'FOG');
    expect(v).not.toBeNull();
    expect(v!.mutation).toBe('NONE');
  });
  it('count 0 이하·비정수 거부', () => {
    expect(validateDirective({ ...ok, composition: [{ type: 'chaser', count: 0, spawn: 'N', elite: false }] }, 3, 'NONE')).toBeNull();
  });
});

describe('budget', () => {
  it('예산은 웨이브에 따라 단조 증가', () => {
    for (let w = 1; w < 7; w++) expect(budgetFor(w + 1)).toBeGreaterThan(budgetFor(w));
  });
  it('비용: chaser 1, shooter 2, splitter 2, elite ×3', () => {
    expect(costOf({ type: 'chaser', count: 4, spawn: 'N', elite: false })).toBe(4);
    expect(costOf({ type: 'shooter', count: 2, spawn: 'N', elite: true })).toBe(12);
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/validator.test.ts` / Expected: FAIL (모듈 없음)

- [ ] **Step 3: 계약 구현** (`src/contracts/directive.ts`)

```ts
import { z } from 'zod';

export const ENEMY_TYPES = ['chaser', 'shooter', 'splitter'] as const;
export const SPAWN_PATTERNS = ['N', 'S', 'E', 'W', 'RING', 'PINCER', 'BEHIND'] as const;
export const MUTATIONS = ['NONE', 'LAVA_LEFT', 'LAVA_RIGHT', 'FOG', 'SPEED_SURGE', 'SHRINK_ARENA', 'SPAWN_STORM'] as const;

export type EnemyType = (typeof ENEMY_TYPES)[number];
export type SpawnPattern = (typeof SPAWN_PATTERNS)[number];
export type Mutation = (typeof MUTATIONS)[number];

export const CompositionSchema = z.object({
  type: z.enum(ENEMY_TYPES),
  count: z.number().int().min(1).max(30),
  spawn: z.enum(SPAWN_PATTERNS),
  elite: z.boolean(),
});

export const DirectiveSchema = z.object({
  composition: z.array(CompositionSchema).min(1).max(4),
  mutation: z.enum(MUTATIONS),
  taunt: z.string().min(1).max(60),
  intent: z.string().min(1).max(100),
});

export type Composition = z.infer<typeof CompositionSchema>;
export type Directive = z.infer<typeof DirectiveSchema>;

export interface WaveLog {
  wave: number;
  clearTimeSec: number;
  hpLost: number;
  damageSources: Partial<Record<EnemyType, number>>;
  movement: { quadrantTime: { NW: number; NE: number; SW: number; SE: number }; wallHugRatio: number; dashCount: number };
  combat: { kills: Partial<Record<EnemyType, number>>; accuracy: number };
  upgrades: string[];
  prevMutations: Mutation[];
}

export const ENEMY_COST: Record<EnemyType, number> = { chaser: 1, shooter: 2, splitter: 2 };
export const ELITE_MULT = 3;

// API structured output용 (zod와 동일 제약 — 프록시에서 사용)
export const DIRECTIVE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    composition: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: [...ENEMY_TYPES] },
          count: { type: 'integer' },
          spawn: { type: 'string', enum: [...SPAWN_PATTERNS] },
          elite: { type: 'boolean' },
        },
        required: ['type', 'count', 'spawn', 'elite'],
        additionalProperties: false,
      },
    },
    mutation: { type: 'string', enum: [...MUTATIONS] },
    taunt: { type: 'string' },
    intent: { type: 'string' },
  },
  required: ['composition', 'mutation', 'taunt', 'intent'],
  additionalProperties: false,
} as const;
```

(주의: structured outputs는 `minimum`/`maxLength` 미지원 — 수치·길이 제약은 zod(클라이언트 검증)가 담당한다. 이래서 이중 검증이다.)

- [ ] **Step 4: 검증기 구현** (`src/director/validator.ts`)

```ts
import { Directive, DirectiveSchema, Mutation, Composition, ENEMY_COST, ELITE_MULT } from '../contracts/directive';

export function budgetFor(wave: number): number {
  return 8 + wave * 4 + Math.max(0, wave - 5) * 12;
}
// w1~5: 12,16,20,24,28 (완만) / w6: 44, w7: 60 (피날레 가속)
// [개정 2026-08-05] 초안(8+4w)은 웨이브 6~7 피날레 뱅크 콘텐츠(엘리트 물량)와 모순 —
// 승인된 콘텐츠를 유지하고 곡선을 가속하는 쪽으로 결정. 최종 수치는 Task 10 밸런싱에서 조정 가능.

export function costOf(c: Composition): number {
  return c.count * ENEMY_COST[c.type] * (c.elite ? ELITE_MULT : 1);
}

export function validateDirective(raw: unknown, wave: number, prevMutation: Mutation): Directive | null {
  const parsed = DirectiveSchema.safeParse(raw);
  if (!parsed.success) return null;
  const d = parsed.data;
  const total = d.composition.reduce((s, c) => s + costOf(c), 0);
  if (total > budgetFor(wave)) return null;
  if (d.mutation !== 'NONE' && d.mutation === prevMutation) return { ...d, mutation: 'NONE' };
  return d;
}
```

- [ ] **Step 5: 통과 확인 + 커밋** — Run: `npx vitest run` / Expected: PASS

```bash
git add -A && git commit -m "feat: 디렉티브 계약(zod+JSON Schema) + 검증기(예산·2연속 규칙)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 폴백 뱅크 — `director/fallbackBank.ts`

**Files:** Create: `src/director/fallbackBank.ts`, Test: `tests/fallbackBank.test.ts`

**Interfaces:** Produces: `OPENING_WAVE: Directive`(웨이브 1 고정), `pickFallback(wave: number, prevMutation: Mutation): Directive`(항상 유효한 디렉티브 반환).

- [ ] **Step 1: 실패하는 테스트**

```ts
import { describe, it, expect } from 'vitest';
import { OPENING_WAVE, pickFallback } from '../src/director/fallbackBank';
import { validateDirective } from '../src/director/validator';

describe('fallbackBank', () => {
  it('오프닝 포함 모든 뱅크 항목이 해당 웨이브 검증을 통과한다', () => {
    expect(validateDirective(OPENING_WAVE, 1, 'NONE')).not.toBeNull();
    for (let w = 2; w <= 7; w++) {
      for (let i = 0; i < 10; i++) {
        const d = pickFallback(w, 'NONE');
        expect(validateDirective(d, w, 'NONE')).not.toBeNull();
      }
    }
  });
  it('직전 mutation과 겹치는 항목은 피해서 뽑는다', () => {
    for (let i = 0; i < 20; i++) expect(pickFallback(3, 'FOG').mutation).not.toBe('FOG');
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/fallbackBank.test.ts` / Expected: FAIL

- [ ] **Step 3: 구현** — 웨이브별 3종 × 6 + 오프닝. 대사는 로그 없이도 성립하는 범용 도발로 작성(폴백은 무음이어야 하므로 "분석" 뉘앙스는 유지하되 특정 습관 지목은 않는다).

```ts
import { Directive, Mutation } from '../contracts/directive';

export const OPENING_WAVE: Directive = {
  composition: [{ type: 'chaser', count: 8, spawn: 'RING', elite: false }],
  mutation: 'NONE',
  taunt: '환영한다. 지금부터 당신을 관찰한다.',
  intent: '오프닝: 기본 조작 관찰',
};

// export 심볼은 OPENING_WAVE 하나로 통일한다 (별칭 export 금지)
const BANK: Record<number, Directive[]> = {
  2: [
    { composition: [{ type: 'chaser', count: 10, spawn: 'PINCER', elite: false }, { type: 'shooter', count: 2, spawn: 'N', elite: false }], mutation: 'NONE', taunt: '워밍업은 끝났다.', intent: '협공 도입' },
    { composition: [{ type: 'chaser', count: 8, spawn: 'BEHIND', elite: false }, { type: 'shooter', count: 3, spawn: 'S', elite: false }], mutation: 'FOG', taunt: '어둠 속에서도 그렇게 움직일 수 있나.', intent: '시야 제한 테스트' },
    { composition: [{ type: 'splitter', count: 6, spawn: 'RING', elite: false }], mutation: 'NONE', taunt: '하나를 죽이면 둘이 된다.', intent: '분열형 도입' },
  ],
  3: [
    { composition: [{ type: 'chaser', count: 12, spawn: 'N', elite: false }, { type: 'shooter', count: 4, spawn: 'S', elite: false }], mutation: 'LAVA_LEFT', taunt: '왼쪽은 이제 내 구역이다.', intent: '공간 압박' },
    { composition: [{ type: 'splitter', count: 8, spawn: 'PINCER', elite: false }], mutation: 'SPEED_SURGE', taunt: '속도를 올려보지.', intent: '템포 상승' },
    { composition: [{ type: 'chaser', count: 6, spawn: 'RING', elite: true }], mutation: 'NONE', taunt: '정예를 보낸다. 영광으로 알아라.', intent: '엘리트 도입' },
  ],
  4: [
    { composition: [{ type: 'shooter', count: 6, spawn: 'RING', elite: false }, { type: 'chaser', count: 8, spawn: 'BEHIND', elite: false }], mutation: 'SHRINK_ARENA', taunt: '무대가 좁아진다. 도망칠 곳도.', intent: '공간 축소 압박' },
    { composition: [{ type: 'splitter', count: 8, spawn: 'N', elite: false }, { type: 'shooter', count: 4, spawn: 'S', elite: false }], mutation: 'FOG', taunt: '보이지 않는 것이 가장 무섭다.', intent: '시야+물량 복합' },
    { composition: [{ type: 'chaser', count: 16, spawn: 'PINCER', elite: false }, { type: 'shooter', count: 4, spawn: 'RING', elite: false }], mutation: 'NONE', taunt: '물량 앞에 장사 없다.', intent: '물량전' },
  ],
  5: [
    { composition: [{ type: 'chaser', count: 10, spawn: 'RING', elite: false }, { type: 'splitter', count: 6, spawn: 'PINCER', elite: false }], mutation: 'SPAWN_STORM', taunt: '끝없이 몰아친다. 버텨봐라.', intent: '지속 압박' },
    { composition: [{ type: 'shooter', count: 4, spawn: 'RING', elite: true }], mutation: 'LAVA_RIGHT', taunt: '오른쪽을 지운다.', intent: '엘리트 사수 + 공간 압박' },
    { composition: [{ type: 'chaser', count: 14, spawn: 'BEHIND', elite: false }, { type: 'shooter', count: 6, spawn: 'N', elite: false }], mutation: 'SPEED_SURGE', taunt: '이 속도를 따라올 수 있나.', intent: '고속 혼전' },
  ],
  6: [
    { composition: [{ type: 'splitter', count: 10, spawn: 'RING', elite: false }, { type: 'chaser', count: 8, spawn: 'PINCER', elite: true }], mutation: 'FOG', taunt: '어둠, 분열, 협공. 전부 동시에.', intent: '복합 시험' },
    { composition: [{ type: 'shooter', count: 8, spawn: 'RING', elite: false }, { type: 'chaser', count: 12, spawn: 'BEHIND', elite: false }], mutation: 'SHRINK_ARENA', taunt: '숨을 곳은 없다.', intent: '탄막+축소' },
    { composition: [{ type: 'chaser', count: 10, spawn: 'N', elite: true }], mutation: 'SPAWN_STORM', taunt: '최정예다. 물러설 곳도 없다.', intent: '엘리트 물량' },
  ],
  7: [
    { composition: [{ type: 'chaser', count: 12, spawn: 'RING', elite: true }, { type: 'shooter', count: 4, spawn: 'PINCER', elite: false }], mutation: 'SHRINK_ARENA', taunt: '마지막 막이다. 전력을 다해라.', intent: '피날레: 총력전' },
    { composition: [{ type: 'splitter', count: 10, spawn: 'PINCER', elite: true }], mutation: 'SPAWN_STORM', taunt: '이것이 나의 연출이다.', intent: '피날레: 분열 폭풍' },
    { composition: [{ type: 'shooter', count: 6, spawn: 'RING', elite: true }, { type: 'chaser', count: 10, spawn: 'BEHIND', elite: false }], mutation: 'FOG', taunt: '엔딩은 어둠 속에서.', intent: '피날레: 암전 총공세' },
  ],
};

export function pickFallback(wave: number, prevMutation: Mutation): Directive {
  const pool = (BANK[wave] ?? BANK[7]).filter((d) => d.mutation === 'NONE' || d.mutation !== prevMutation);
  return pool[Math.floor(Math.random() * pool.length)];
}
```

- [ ] **Step 4: 통과 확인 + 커밋** — Run: `npx vitest run` / Expected: PASS. 커밋: `feat: 폴백 디렉티브 뱅크 (오프닝 + 웨이브별 3종)`

(참고: 뱅크 항목의 예산이 `budgetFor` 상한을 넘으면 이 테스트가 잡는다 — 밸런싱 때 예산 조정 시 함께 갱신.)

---

### Task 4: 텔레메트리 — `telemetry/collector.ts`

**Files:** Create: `src/telemetry/collector.ts`, Test: `tests/collector.test.ts`

**Interfaces:** Produces: `class WaveTelemetry` — `tick(x,y,arenaW,arenaH,dtSec)`, `recordShot(hit: boolean)`, `recordKill(t: EnemyType)`, `recordDamage(t: EnemyType)`, `recordDash()`, `finish(wave, clearTimeSec, upgrades, prevMutations): WaveLog`. ArenaScene(Task 5·6)이 소비.

- [ ] **Step 1: 실패하는 테스트**

```ts
import { describe, it, expect } from 'vitest';
import { WaveTelemetry } from '../src/telemetry/collector';

describe('WaveTelemetry', () => {
  it('사분면 체류·명중률·킬·피격이 로그로 집계된다', () => {
    const t = new WaveTelemetry();
    // 왼쪽 벽 NW(x=10)에서 2초, 비벽면(480,320 — 정중앙은 strict < 버킷팅으로 SE)에서 1초,
    // 오른쪽 벽 SE(900,500)에서 0.5초 — 벽면·사분면 지표가 서로 다른 값이 되도록 설계
    for (let i = 0; i < 20; i++) t.tick(10, 100, 960, 640, 0.1);
    for (let i = 0; i < 10; i++) t.tick(480, 320, 960, 640, 0.1);
    for (let i = 0; i < 5; i++) t.tick(900, 500, 960, 640, 0.1);
    t.recordShot(true); t.recordShot(true); t.recordShot(false);
    t.recordKill('chaser'); t.recordDamage('shooter'); t.recordDash();
    const log = t.finish(2, 30, ['DAMAGE_UP'], ['NONE']);
    expect(log.wave).toBe(2);
    expect(log.combat.accuracy).toBeCloseTo(2 / 3);
    expect(log.combat.kills.chaser).toBe(1);
    expect(log.damageSources.shooter).toBe(1);
    expect(log.hpLost).toBe(1);
    expect(log.movement.dashCount).toBe(1);
    expect(log.movement.quadrantTime.NW).toBeGreaterThan(0.5); // 2.0/3.5 ≈ 0.57
    expect(log.movement.wallHugRatio).toBeGreaterThan(log.movement.quadrantTime.NW); // 2.5/3.5 ≈ 0.71 — 두 지표 독립 검증(바꿔치기 시 실패)
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/collector.test.ts` / Expected: FAIL

- [ ] **Step 3: 구현**

```ts
import { EnemyType, Mutation, WaveLog } from '../contracts/directive';

const WALL_MARGIN = 80;

export class WaveTelemetry {
  private quad = { NW: 0, NE: 0, SW: 0, SE: 0 };
  private wallTime = 0;
  private totalTime = 0;
  private shots = 0;
  private hits = 0;
  private kills: Partial<Record<EnemyType, number>> = {};
  private damage: Partial<Record<EnemyType, number>> = {};
  private dashes = 0;

  tick(x: number, y: number, w: number, h: number, dt: number) {
    this.totalTime += dt;
    const key = `${y < h / 2 ? 'N' : 'S'}${x < w / 2 ? 'W' : 'E'}` as keyof typeof this.quad;
    this.quad[key] += dt;
    if (x < WALL_MARGIN || x > w - WALL_MARGIN || y < WALL_MARGIN || y > h - WALL_MARGIN) this.wallTime += dt;
  }
  recordShot(hit: boolean) { this.shots++; if (hit) this.hits++; }
  recordKill(t: EnemyType) { this.kills[t] = (this.kills[t] ?? 0) + 1; }
  recordDamage(t: EnemyType) { this.damage[t] = (this.damage[t] ?? 0) + 1; }
  recordDash() { this.dashes++; }

  finish(wave: number, clearTimeSec: number, upgrades: string[], prevMutations: Mutation[]): WaveLog {
    const total = Math.max(this.totalTime, 0.001);
    const norm = (v: number) => Math.round((v / total) * 100) / 100;
    return {
      wave, clearTimeSec,
      hpLost: Object.values(this.damage).reduce((s, n) => s + (n ?? 0), 0),
      damageSources: this.damage,
      movement: {
        quadrantTime: { NW: norm(this.quad.NW), NE: norm(this.quad.NE), SW: norm(this.quad.SW), SE: norm(this.quad.SE) },
        wallHugRatio: norm(this.wallTime),
        dashCount: this.dashes,
      },
      combat: { kills: this.kills, accuracy: this.shots ? Math.round((this.hits / this.shots) * 100) / 100 : 0 },
      upgrades, prevMutations,
    };
  }
}
```

- [ ] **Step 4: 통과 확인 + 커밋** — `feat: 웨이브 텔레메트리 집계기`

---

### Task 5: 코어 게임 — 씬·플레이어·적·전투

**Files:** Create: `src/game/entities.ts`, `src/game/scenes/ArenaScene.ts`, `src/game/scenes/TitleScene.ts`; Modify: `src/main.ts`

**Interfaces:**
- Consumes: `WaveTelemetry` (Task 4)
- Produces: `ArenaScene` — `player: Player`, `enemies: Phaser.Physics.Arcade.Group`, `spawnEnemy(type, x, y, elite)`, 이벤트 `'wave-cleared'`(적 전멸 시 emit), `'player-died'`. `Player` — `hp`, `stats: PlayerStats {damage, fireRateMs, moveSpeed, bulletSpeed, pierce, multishot, dashCooldownMs}`. Task 6·8이 소비.

이 태스크는 수동 플레이 검증(하네스는 tsc만 관여). 텍스처는 전부 `Graphics.generateTexture`로 생성 — 에셋 파일 0.

- [ ] **Step 1: 엔티티 구현** (`src/game/entities.ts`) — 핵심 형태:

```ts
import Phaser from 'phaser';
import { EnemyType } from '../contracts/directive';

export interface PlayerStats {
  damage: number; fireRateMs: number; moveSpeed: number; bulletSpeed: number;
  pierce: number; multishot: number; dashCooldownMs: number;
}
export const BASE_STATS: PlayerStats = {
  damage: 1, fireRateMs: 280, moveSpeed: 220, bulletSpeed: 480, pierce: 0, multishot: 1, dashCooldownMs: 2000,
};

export const ENEMY_DEF: Record<EnemyType, { hp: number; speed: number; size: number }> = {
  chaser:   { hp: 2, speed: 90,  size: 14 },
  shooter:  { hp: 3, speed: 60,  size: 15 },
  splitter: { hp: 3, speed: 75,  size: 16 },
};
```

Player: WASD 이동, Space 대시(0.3초 무적+속도 3배, 쿨다운 `stats.dashCooldownMs`), 자동 사격(가장 가까운 적, `fireRateMs` 간격, `multishot`은 ±12° 부채꼴). 피격 시 hp-1 + 1초 무적(깜빡임). 흰 원 텍스처 + 조준 방향 노치.

Enemy: `spawn(type, elite)` — elite면 hp×3·크기 1.4배·틴트 0xff2d2d. 행동은 update에서 타입 분기: chaser 직진 / shooter 260px 거리 유지 + 1.6초마다 조준탄 / splitter 사망 시 소형(hp1·크기 0.6배) 2기 분열. 도형 텍스처: 삼각·사각·육각.

Bullet: 플레이어탄(관통 카운트 `pierce`), 적탄 별도 그룹.

- [ ] **Step 2: ArenaScene 조립** — 물리 그룹·충돌(플레이어탄↔적, 적/적탄↔플레이어), HUD(웨이브·HP 하트·대시 쿨 게이지), `WaveTelemetry` 연결(tick은 update에서, recordShot/Kill/Damage/Dash를 각 지점에서 호출). 적 전멸 감지 → `'wave-cleared'` emit. hp 0 → `'player-died'`. 이 단계에서는 임시로 OPENING_WAVE만 수동 스폰해 전투 루프를 확인.

TitleScene: 타이틀 + "클릭해서 시작" + 조작 안내 1줄. main.ts에 `[TitleScene, ArenaScene]` 등록.

- [ ] **Step 3: 수동 검증** — Run: `npm run dev`
확인: WASD 이동·대시 무적·자동 사격이 감각적으로 동작 / chaser 추격·shooter 탄·splitter 분열 / 피격 시 HP 감소·무적 깜빡임 / 적 전멸 시 콘솔에 wave-cleared 로그 / devtools Performance로 적 50기 스폰 시(콘솔에서 강제 스폰) 55fps+.

- [ ] **Step 4: 하네스 + 커밋** — `bash scripts/ai_harness.sh --fast` PASS 후 커밋: `feat: 코어 전투 루프 — 플레이어·적 3종·충돌·HUD`

---

### Task 6: 웨이브 실행기 + 변주 — 디렉티브로 게임 완주

**Files:** Create: `src/game/waveRunner.ts`, `src/game/mutations.ts`; Modify: `src/game/scenes/ArenaScene.ts`

**Interfaces:**
- Consumes: `Directive`, `OPENING_WAVE`, `pickFallback`, ArenaScene의 `spawnEnemy`
- Produces: `runDirective(scene: ArenaScene, d: Directive): void` — composition을 스폰 패턴 좌표로 변환해 스폰(SPAWN_STORM이면 4초 간격 분할 스폰), mutation 활성화. `clearMutation(scene)` — 웨이브 종료 시 해제.

- [ ] **Step 1: 스폰 패턴 구현** (`waveRunner.ts`) — 패턴→좌표: N/S/E/W(해당 변 바깥 랜덤), RING(플레이어 중심 반경 320px 원주 균등), PINCER(플레이어 진행 방향 앞뒤 2그룹), BEHIND(플레이어 이동 반대 방향). 화면 밖 40px에서 진입.

- [ ] **Step 2: mutation 구현** (`mutations.ts`)

| Mutation | 효과 (구체값) |
|---|---|
| LAVA_LEFT / RIGHT | 해당 절반에 반투명 레드 존, 체류 1초당 HP 0.5 (내부 누적, 1 도달 시 피격 처리) |
| FOG | 플레이어 중심 반경 240px 밖 알파 0.85 어둠 오버레이 |
| SPEED_SURGE | 적 이속 +25% |
| SHRINK_ARENA | 아레나 경계 상하좌우 12%씩 축소(경계 밖 = LAVA와 동일 판정), 웨이브 동안 유지 |
| SPAWN_STORM | composition을 3분할해 4초 간격 순차 스폰 |

적용은 `runDirective`가, 해제는 `clearMutation`이 담당. 레드(#ff2d2d)는 여기(디렉터의 개입)에서만 쓴다.

- [ ] **Step 3: ArenaScene에 웨이브 루프 연결** — 상태 머신: `WAVE_RUNNING → (wave-cleared) → INTERVAL(지금은 2초 대기 placeholder) → 다음 웨이브 runDirective(pickFallback(...)) → … → 7웨이브 클리어 시 콘솔 WIN / player-died 시 콘솔 LOSE`. 직전 mutation을 추적해 pickFallback에 전달.

- [ ] **Step 4: 수동 검증** — LLM 없이 뱅크만으로 1~7 웨이브 완주 가능 확인(무적 치트 플래그 `window.__god=true` 지원 — 검증용). 각 mutation이 육안으로 구분되는지 확인.

- [ ] **Step 5: 하네스 + 커밋** — `feat: 디렉티브 실행기 + 변주 6종 — 뱅크만으로 완주 가능`

**여기가 첫 번째 마일스톤: LLM 없이 완전한 게임.** 이후 태스크가 전부 밀려도 제출물은 성립한다.

---

### Task 7: 디렉터 연동 — Edge Function 프록시 + 클라이언트

**Files:** Create: `supabase/functions/director/index.ts`, `src/director/client.ts`, Test: `tests/directorClient.test.ts`

**Interfaces:**
- Consumes: `WaveLog`, `validateDirective`, `pickFallback`, `DIRECTIVE_JSON_SCHEMA`
- Produces: `requestDirective(log: WaveLog, wave: number, prevMutation: Mutation): Promise<{ directive: Directive; fromLLM: boolean }>` — 4초 내 반드시 resolve(실패 시 폴백). `DIRECTOR_URL` 상수는 `import.meta.env.VITE_DIRECTOR_URL`(없으면 오프라인 모드 = 항상 폴백).

- [ ] **Step 1: Edge Function 작성** (`supabase/functions/director/index.ts`) — Deno. Anthropic 공식 SDK 사용:

```ts
import Anthropic from 'npm:@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });
const ALLOWED_ORIGIN = 'https://byseungje.github.io';
const MAX_CALLS_PER_SESSION = 20;
const MAX_CALLS_PER_DAY = 500; // 일일 캡 확정값(스펙 4절 위임): Haiku 기준 최악 수천 원. 인스턴스 근사 — 하드캡은 Anthropic 콘솔 워크스페이스 spend limit(승제 설정)
const sessionCounts = new Map<string, number>(); // 인스턴스 수명 내 근사 캡(콜드스타트 리셋 허용)
let dailyCount = { date: '', n: 0 };
function overDailyCap(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (dailyCount.date !== today) dailyCount = { date: today, n: 0 };
  return ++dailyCount.n > MAX_CALLS_PER_DAY;
}

const SYSTEM = `너는 아케이드 게임의 'AI 디렉터'다. 플레이어의 웨이브 로그를 읽고 다음 웨이브를 설계한다.
규칙:
- composition 총 비용(chaser 1, shooter 2, splitter 2, elite는 ×3)은 예산 이하로. 예산은 사용자 메시지에 준다.
- taunt는 한국어 60자 이내. 반드시 로그에서 실제로 관찰되는 습관 하나를 콕 집어 지목하라(예: 벽 붙기 wallHugRatio, 특정 사분면 체류, 낮은 명중률, 대시 남용, 특정 적에게 반복 피격, 업그레이드 성향). 그리고 설계가 그 습관을 실제로 공략해야 한다.
- 해석 규칙: hpLost가 damageSources 합보다 크면 그 차이는 지형 피해(용암 존·축소 경계)다 — 지형에 자주 타는 플레이어에게는 그 습관을 지목할 수 있다.
- 직전 mutation과 같은 것은 고르지 마라.
- 어렵지만 이길 수 있게: 플레이어가 고전한 요소는 유지하되 물량으로 압살하지 마라.
- intent는 설계 의도 100자 이내.`;

Deno.serve(async (req) => {
  const cors = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'content-type',
    'Content-Type': 'application/json',
  };
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  try {
    const { mode, log, wave, budget, prevMutation, sessionId, runSummary } = await req.json();
    const used = sessionCounts.get(sessionId) ?? 0;
    if (used >= MAX_CALLS_PER_SESSION || overDailyCap()) return new Response(JSON.stringify({ error: 'cap' }), { status: 429, headers: cors });
    sessionCounts.set(sessionId, used + 1);

    if (mode === 'report') {
      const msg = await client.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 700,
        system: '너는 게임의 AI 디렉터다. 방금 끝난 판의 전체 로그를 보고, 플레이어의 스타일을 분석하는 리포트를 한국어 400자 내외로 써라. 마지막 줄에 "칭호: <4~8자 칭호>" 형식으로 칭호를 붙여라. 관찰된 사실만 근거로, 디렉터의 시점(1인칭)으로, 패배시켰다면 여유롭게, 패배했다면 인정하며.',
        messages: [{ role: 'user', content: JSON.stringify(runSummary) }],
      });
      const text = msg.content.find((b) => b.type === 'text')?.text ?? '';
      return new Response(JSON.stringify({ report: text }), { headers: cors });
    }

    const msg = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 500,
      system: SYSTEM,
      output_config: { format: { type: 'json_schema', schema: DIRECTIVE_JSON_SCHEMA } },
      messages: [{ role: 'user', content: `웨이브 ${wave} 설계. 예산: ${budget}. 직전 mutation: ${prevMutation}.\n플레이 로그:\n${JSON.stringify(log)}` }],
    });
    const text = msg.content.find((b) => b.type === 'text')?.text ?? '{}';
    return new Response(JSON.stringify({ directive: JSON.parse(text) }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
});
```

`DIRECTIVE_JSON_SCHEMA`는 `src/contracts/directive.ts`의 것을 이 파일 상단에 복사해 상수로 둔다(Edge Function은 별도 번들 — 계약 변경 시 두 곳 동기화, CLAUDE.md에 명시).

- [ ] **Step 2: 배포** (승제 supabase 계정·CLI 로그인 전제)

```bash
supabase functions deploy director --no-verify-jwt
supabase secrets set ANTHROPIC_API_KEY=<승제 개인 키>   # 키 값은 승제가 직접 입력
```

curl로 스모크 테스트: 가짜 WaveLog POST → JSON directive 응답 확인. Anthropic 콘솔에서 usage 1건 확인.

- [ ] **Step 3: 클라이언트 테스트 작성** (`tests/directorClient.test.ts`) — fetch를 vi.stubGlobal로 모킹:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { requestDirective } from '../src/director/client';

const okDirective = {
  composition: [{ type: 'chaser', count: 5, spawn: 'N', elite: false }],
  mutation: 'FOG', taunt: '벽을 좋아하는군.', intent: '벽 차단',
};
const fakeLog: any = { wave: 2, clearTimeSec: 30, hpLost: 0, damageSources: {}, movement: { quadrantTime: { NW: 1, NE: 0, SW: 0, SE: 0 }, wallHugRatio: 0.8, dashCount: 2 }, combat: { kills: {}, accuracy: 0.5 }, upgrades: [], prevMutations: [] };

afterEach(() => vi.unstubAllGlobals());

describe('requestDirective', () => {
  it('정상 응답이면 LLM 디렉티브 반환', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ directive: okDirective }))));
    const r = await requestDirective(fakeLog, 3, 'NONE');
    expect(r.fromLLM).toBe(true);
    expect(r.directive.taunt).toContain('벽');
  });
  it('네트워크 오류면 폴백', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    const r = await requestDirective(fakeLog, 3, 'NONE');
    expect(r.fromLLM).toBe(false);
  });
  it('스키마 위반 응답이면 폴백', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ directive: { mutation: 'EARTHQUAKE' } }))));
    const r = await requestDirective(fakeLog, 3, 'NONE');
    expect(r.fromLLM).toBe(false);
  });
  it('4초 초과면 폴백', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_u, opts: any) => new Promise((_res, rej) => {
      opts.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
    })));
    const p = requestDirective(fakeLog, 3, 'NONE');
    await vi.advanceTimersByTimeAsync(4100);
    const r = await p;
    expect(r.fromLLM).toBe(false);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 4: 실패 확인** — Run: `npx vitest run tests/directorClient.test.ts` / Expected: FAIL

- [ ] **Step 5: 클라이언트 구현** (`src/director/client.ts`)

```ts
import { Directive, Mutation, WaveLog } from '../contracts/directive';
import { validateDirective, budgetFor } from './validator';
import { pickFallback } from './fallbackBank';

const TIMEOUT_MS = 4000;
const DIRECTOR_URL: string | undefined = import.meta.env?.VITE_DIRECTOR_URL;
export const sessionId = crypto.randomUUID();

export async function requestDirective(
  log: WaveLog, wave: number, prevMutation: Mutation,
): Promise<{ directive: Directive; fromLLM: boolean }> {
  if (!DIRECTOR_URL) return { directive: pickFallback(wave, prevMutation), fromLLM: false };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(DIRECTOR_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'directive', log, wave, budget: budgetFor(wave), prevMutation, sessionId }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const body = await res.json();
    const valid = validateDirective(body.directive, wave, prevMutation);
    if (!valid) throw new Error('invalid directive');
    return { directive: valid, fromLLM: true };
  } catch {
    return { directive: pickFallback(wave, prevMutation), fromLLM: false };
  } finally {
    clearTimeout(timer);
  }
}
```

`.env`(gitignore됨)에 `VITE_DIRECTOR_URL=<edge function url>`, Actions에는 repo Variables로 주입(`deploy.yml`의 build step에 `env: { VITE_DIRECTOR_URL: ${{ vars.VITE_DIRECTOR_URL }} }` 추가).

- [ ] **Step 6: 통과 확인** — Run: `npx vitest run` / Expected: PASS

- [ ] **Step 7: 게임에 연결 + 실플레이 검증** — ArenaScene의 INTERVAL placeholder에서 `requestDirective(텔레메트리 로그)` 호출로 교체. 실플레이 2런: 대사가 실제 내 습관(벽 붙기 등)을 지목하는지, 네트워크 차단(devtools offline) 시 폴백으로 끊김 없이 진행되는지.

- [ ] **Step 8: 하네스 + 커밋** — `feat: 디렉터 LLM 연동 — 프록시·타임아웃·무음 폴백`

---

### Task 8: 인터벌 UX — 대사 연출·업그레이드·로그 패널

**Files:** Create: `src/ui/interval.ts`, `src/game/upgrades.ts`, `src/ui/directorLog.ts`; Modify: `ArenaScene.ts`

**Interfaces:**
- Consumes: `Directive`, `PlayerStats`
- Produces: `runInterval(scene, directive, onDone: (picked: UpgradeId) => void)` — 대사 타이핑 연출(글자당 30ms, 레드 텍스트, 스킵 클릭 지원) → 업그레이드 3택1 카드 → 선택 시 onDone. `UPGRADES: Record<UpgradeId, {name, desc, apply(stats): PlayerStats}>` 8종(스펙 3.2): DAMAGE_UP(+1), FIRE_RATE_UP(간격 ×0.85), MOVE_SPEED_UP(+12%), HP_PLUS(최대+1·회복+1), PIERCE(+1), MULTI_SHOT(+1), BULLET_SPEED_UP(+20%), DASH_CD_DOWN(×0.8).

- [ ] **Step 1: upgrades.ts** — 정의 테이블 + `pick3(): UpgradeId[]`(무작위 3종, 중복 없음). 간단 유닛 테스트 1개(tests/upgrades.test.ts: pick3가 서로 다른 3종 반환, apply가 스탯을 실제로 바꿈).

- [ ] **Step 2: interval.ts** — 화면 하단 디렉터 패널(검정 박스 + 레드 보더 + "🅳 DIRECTOR"), taunt 타이핑 연출, 완료 후 카드 3장(이름·설명, 호버 확대, 클릭 선택). 선택한 업그레이드는 텔레메트리 upgrades에 기록.

- [ ] **Step 3: directorLog.ts (컷 후보)** — L키 토글, 우측에 최근 디렉티브 JSON + fromLLM 뱃지 표시(시연·영상용).

- [ ] **Step 3.5: dev QA 훅** *(추가 2026-08-05 — 백그라운드 탭 RAF 정지로 원격 플레이 QA 불가 확인)* — dev 빌드에서만(`import.meta.env.DEV`): `window.__game = game`(main.ts), ArenaScene에 `window.__skipWave()`(현재 웨이브 즉시 클리어 처리) 노출. 컨트롤러가 mutation 육안 검증·완주 QA를 빠르게 수행하기 위한 장치. 프로덕션 번들에서는 제외.

- [ ] **Step 4: 수동 검증 + 커밋** — 인터벌 흐름이 8초 내외로 리드미컬한지, 업그레이드가 체감되는지. 커밋: `feat: 디렉터 인터벌 — 대사 연출·업그레이드 3택1·로그 패널`

---

### Task 9: 엔드게임 + 주스 + 사운드

**Files:** Create: `src/director/report.ts`, `src/game/scenes/EndScene.ts`, `src/game/juice.ts`; Modify: `ArenaScene.ts`, `main.ts`

**Interfaces:**
- Consumes: 전체 런 요약(웨이브별 WaveLog 배열 + 결과), 프록시 `mode: 'report'`
- Produces: `requestReport(runSummary): Promise<string>`(8초 타임아웃, 실패 시 정적 템플릿: 승/패 2종 + 통계 삽입), EndScene(결과 + 리포트 타이핑 + 칭호 강조 + 리스타트 버튼).

- [ ] **Step 1: report.ts** — client.ts와 동일 패턴(타임아웃만 8초). 정적 폴백 템플릿에 킬 수·정확도·생존 웨이브 삽입.

- [ ] **Step 2: EndScene** — WIN: "디렉터 격파" / LOSE: "DIRECTOR'S CUT — 편집당했다". 리포트 타이핑 연출, 칭호는 크게. R키/버튼 리스타트(씬 재시작 + 스탯 리셋 + sessionId 유지).

- [ ] **Step 3: juice.ts** — 피격 카메라 흔들림(80ms·0.008), 처치 파티클(도형 파편 6개), 웨이브 클리어 슬로모(timeScale 0.4→1.0, 0.5초), 대시 잔상. 전부 Phaser 내장(파티클·트윈)으로.

- [ ] **Step 4: zzfx 사운드 4종** — `npm i zzfx`: 사격(짧은 픽), 피격(로우 노이즈), 처치(팝), 웨이브 클리어(상승 아르페지오). 음소거 토글 M키.

- [ ] **Step 5: 수동 검증 + 하네스 + 커밋** — 승·패 양 경로 리포트 표시, 리스타트 동작. `feat: 엔드게임 리포트·주스·사운드`

---

### Task 10: 밸런싱 + 완료 기준 검증 (8/9)

**Files:** Modify: 수치 파일들(`validator.ts`의 budgetFor, `entities.ts`의 BASE_STATS·ENEMY_DEF, 뱅크)

- [ ] **Step 1: 승제 실플레이 세션 ×2** — 조정 축: 첫 클리어까지 재시도 2~4회가 되도록(너무 쉬움/어려움 양쪽 컷), 런 길이 5~7분, 디렉터 대사 적중감(로그 패널로 확인). 대사 품질이 부족하면 프록시 SYSTEM 프롬프트 조정(모델 교체는 스펙 개정 필요 — 승제 게이트).
- [ ] **Step 2: 스펙 5절 완료 기준 1~7 전 항목 검증 런** — 각 항목 ✅/❌ 기록. 장애 주입(devtools offline·프록시 secret 제거·스키마 위반은 유닛으로 커버) 포함. 결과를 `docs/verification/2026-08-09-checklist.md`에 기록.
- [ ] **Step 3: 스펙 진행 상태 체크마크 갱신 + 커밋**

### Task 11: 산출물 + 제출 (8/9 밤 ~ 8/10 오전)

- [ ] **Step 1: 영상 (30~60초)** — 시나리오: ① 타이틀 1초 ② 플레이 5초 ③ 디렉터 대사가 내 습관 지목 + 판이 바뀜 (2회, 로그 패널 잠깐 노출) ④ 최종 리포트+칭호 ⑤ 엔드 카드(게임명+URL) 1초. macOS 화면 녹화(⌘⇧5) → iMovie/ffmpeg 컷 편집. AI 합성·조작 없음(공고 요구). YouTube 일부공개 업로드.
- [ ] **Step 2: 게임 소개 PDF (1~2p)** — 제목·한줄소개 / 게임 방법(목표·조작·종료 조건) / 실행 방법(URL 클릭) / 플레이·영상 링크. sj:doc 스킬 톤 적용.
- [ ] **Step 3: AI 활용 기술 문서 PDF (3~5p)** — 2층 구조: **[게임 내 AI]** 디렉터 아키텍처 다이어그램(로그→프록시→structured output→검증→실행), 시스템 프롬프트 전문, 권한 경계(어휘·예산·폴백) 설계 근거, 실측 지연·비용. **[개발 AI]** AI-DLC 파이프라인(스펙→플랜→구현→하네스 게이트), 실제 사용 도구(Claude Code 등)·주요 프롬프트, 커밋 히스토리 통계, 외부 오픈소스 목록(Phaser·zod·zzfx — 라이선스 명기). 공고 요구("구조 설명, AI 대상 주요 프롬프트 및 지시 사항") 직격.
- [ ] **Step 4: 최종 점검** — repo public 확인, Pages 링크 시크릿 창에서 실행, YouTube 링크 접근, PDF 3종(1인이라 롤 기술서 제외) 오탈자.
- [ ] **Step 5: 제출 — 승제 직접** — 구글폼(개인정보 입력·동의·파일 업로드). 8/10 오전 완료 목표, 8/9 밤까지 제출 가능 상태 유지. **사전 확인: 앤솔루션 사규(승제 액션 아이템)**.

---

## 일정 매핑

| 저녁 | 태스크 |
|---|---|
| 8/5 (수) | Task 1–4 (스캐폴딩·계약·뱅크·텔레메트리 — 전부 하네스로 검증 가능) |
| 8/6 (목) | Task 5 (코어 전투) |
| 8/7 (금) | Task 6–7 (완주 가능 마일스톤 + LLM 연동) |
| 8/8 (토) | Task 8–9 (인터벌 UX·엔드게임·주스) |
| 8/9 (일) | Task 10–11 (밸런싱·영상·문서) |
| 8/10 (월) | 최종 점검·제출 (오전) |

## 리스크 메모

- **대사 품질**: Haiku가 습관 지목을 못 하면 SYSTEM 프롬프트에 로그 필드 해석 가이드를 더 넣는다(예: "wallHugRatio 0.5↑면 벽 붙기 습관"). 그래도 부족하면 모델 상향은 스펙 amendment로 승제 게이트에 올린다.
- **Edge Function 콜드스타트**: 첫 호출 ~1-2초 추가 가능. 게임 시작 시(타이틀에서) 워밍업 핑 1회 발사(캡에 미산입되게 mode: 'ping' 추가) — Task 7에서 여유 있으면, 없으면 4초 타임아웃이 흡수.
- **세션 캡의 인스턴스 리셋**: Edge Function 인스턴스 재시작 시 카운터 초기화 — 해커톤 규모에선 수용. Anthropic 콘솔 usage 알림을 보조 방어선으로(승제가 콘솔에서 설정).
