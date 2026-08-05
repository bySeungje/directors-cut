# 강화 카드 7종 — 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) 구문으로 추적한다.

**Goal:** 디렉터가 적 **구성**뿐 아니라 **성능**도 웨이브마다 조정해 플레이어의 강점을 표적 공략하게 한다.

**Architecture:** 디렉티브에 `buff` 필드(enum 7종)를 추가한다. 수치는 LLM이 정하지 못하고 카드만 고른다. 효과는 `src/game/buffs.ts`의 **순수 조회 함수**로 노출하고, 엔티티가 스탯을 계산할 때 그 함수를 통과시킨다. 활성 카드는 mutation과 같은 모듈 싱글턴으로 두되, 조회 함수가 순수해 단위 테스트가 가능하다.

**Tech Stack:** TypeScript + zod(계약) / vitest(유닛) / Phaser 4(엔티티) / Deno Edge Function(프록시)

## Global Constraints (스펙 §3.4.1에서 발췌 — 모든 태스크에 적용)

- **카드 7종과 효과는 스펙 §3.4.1 표가 SSOT.** 수치를 임의로 바꾸지 마라: `TOUGH` 전 적 HP +1 / `SWIFT` 전 적 이속 +25% / `RELENTLESS` chaser 이속 +45%·chaser HP −1(최소 1) / `RAPID_FIRE` shooter 발사 간격 ×0.6 / `MARKSMAN` shooter 탄속 +50%·유지거리 +80 / `VOLATILE` splitter 분열 소형 2→3기 / `NONE` 없음.
- **적용 순서**: `ENEMY_DEF` 기본값 → elite 배수 → 강화 카드. mutation(SPEED_SURGE 등)은 매 프레임 적용이라 자연히 마지막에 곱해진다.
- **비용 = 해당 웨이브 예산의 25%(반올림)**, `NONE`은 0. `composition` 비용과 합산해 예산을 넘으면 디렉티브 거부(폴백).
- **직전 웨이브와 동일 카드 금지**(`NONE` 제외) — 위반 시 거부가 아니라 `NONE`으로 **강제 교체**(mutation과 동일 규칙).
- **웨이브 종료 시 초기화** — 절대 누적 금지.
- **폴백 뱅크 19항목은 전부 `buff: 'NONE'`.**
- **웨이브 1에 강제 로직은 필요 없다.** 웨이브 1은 `beginWave(OPENING_WAVE)`로 고정 시작하고 디렉터 호출(`requestDirective`)은 웨이브 종료 후 다음 웨이브분만 일어난다. `OPENING_WAVE.buff = 'NONE'`이면 스펙의 "웨이브 1은 항상 NONE"이 자동 충족된다 — 별도 분기를 추가하지 마라.
- 계약 SSOT는 `src/contracts/directive.ts`. `supabase/functions/director/index.ts`의 JSON Schema 수동 사본을 **반드시 함께** 갱신한다(CLAUDE.md 규약).
- 커밋 전 `bash scripts/ai_harness.sh --fast` PASS 필수. 트레일러 유지. **push는 컨트롤러가 한다 — 에이전트는 금지.**

## 파일 구조

```
src/contracts/directive.ts   수정 — BUFF_CARDS enum·BuffCard 타입·DirectiveSchema.buff·BUFF_COST_RATIO·JSON Schema 사본
src/director/validator.ts    수정 — buffCostOf()·예산 합산·2연속 금지·시그니처에 prevBuff 추가
src/game/buffs.ts            신규 — 활성 카드 상태 + 순수 조회 함수 6개 (이 기능의 핵심 단위)
src/game/entities.ts         수정 — spawn()의 hp·speed, updateShooter()의 간격·거리·탄속이 조회 함수를 통과
src/game/waveRunner.ts       수정 — runDirective에서 setActiveBuff, clearMutation에서 clearBuff
src/game/scenes/ArenaScene.ts 수정 — prevBuff 필드, splitter 분열 수를 조회 함수로
src/director/client.ts       수정 — validateDirective 호출에 prevBuff 전달
src/director/fallbackBank.ts 수정 — 19항목에 buff: 'NONE'
supabase/functions/director/index.ts 수정 — JSON Schema 사본 + 시스템 프롬프트에 카드↔지표 대응표
tests/buffs.test.ts          신규 — 조회 함수 6개
tests/validator.test.ts      수정 — buff 비용·2연속 규칙
tests/fallbackBank.test.ts   수정 — 전 항목 buff NONE 검증
docs/submission/ai-tech.html 수정 — 1.2 계약·1.3 프롬프트·1.4 권한 경계에 buff 반영 → PDF 재생성
```

---

### Task 1: 계약 + 검증기

**Files:**
- Modify: `src/contracts/directive.ts`, `src/director/validator.ts`, `src/director/client.ts`
- Test: `tests/validator.test.ts`

**Interfaces:**
- Consumes: 기존 `budgetFor(wave)`, `costOf(comp)`, `ENEMY_COST`, `ELITE_MULT`
- Produces (이후 태스크가 소비):
  - `BUFF_CARDS` (readonly 배열), `type BuffCard`
  - `Directive`에 `buff: BuffCard` 필드
  - `buffCostOf(card: BuffCard, wave: number): number`
  - `validateDirective(raw: unknown, wave: number, prevMutation: Mutation, prevBuff: BuffCard): Directive | null`

- [ ] **Step 1: 실패하는 테스트 추가** — `tests/validator.test.ts`의 기존 `import` 줄에 `buffCostOf`를 추가하고(`import { validateDirective, budgetFor, costOf, buffCostOf } from '../src/director/validator';`), 파일 상단의 `ok` 상수에 `buff: 'NONE'`을 추가한 뒤, 파일 끝에 아래 describe 블록을 붙인다.

```ts
describe('강화 카드', () => {
  it('buff 필드가 없으면 거부', () => {
    const { buff, ...noBuff } = { ...ok };
    expect(validateDirective(noBuff, 3, 'NONE', 'NONE')).toBeNull();
  });
  it('enum 밖 카드 거부', () => {
    expect(validateDirective({ ...ok, buff: 'GODMODE' }, 3, 'NONE', 'NONE')).toBeNull();
  });
  it('NONE 비용은 0, 그 외는 예산의 25% 반올림', () => {
    expect(buffCostOf('NONE', 3)).toBe(0);
    expect(buffCostOf('TOUGH', 3)).toBe(Math.round(budgetFor(3) * 0.25));
    expect(buffCostOf('SWIFT', 7)).toBe(Math.round(budgetFor(7) * 0.25));
  });
  it('buff 비용이 예산에 합산돼 초과분을 거부한다', () => {
    // 웨이브 3 예산 20, buff 비용 5 → composition 상한은 15
    const near = { ...ok, composition: [{ type: 'chaser', count: 16, spawn: 'N', elite: false }], buff: 'TOUGH' };
    expect(validateDirective(near, 3, 'NONE', 'NONE')).toBeNull();
    const fits = { ...ok, composition: [{ type: 'chaser', count: 15, spawn: 'N', elite: false }], buff: 'TOUGH' };
    expect(validateDirective(fits, 3, 'NONE', 'NONE')).not.toBeNull();
  });
  it('buff 없이는 예산 전액을 composition에 쓸 수 있다', () => {
    const full = { ...ok, composition: [{ type: 'chaser', count: 20, spawn: 'N', elite: false }], buff: 'NONE' };
    expect(validateDirective(full, 3, 'NONE', 'NONE')).not.toBeNull();
  });
  it('직전과 같은 카드는 NONE으로 강제 교체(거부 아님)', () => {
    const v = validateDirective({ ...ok, buff: 'TOUGH' }, 3, 'NONE', 'TOUGH');
    expect(v).not.toBeNull();
    expect(v!.buff).toBe('NONE');
  });
  it('직전이 NONE이면 NONE을 다시 써도 통과', () => {
    const v = validateDirective({ ...ok, buff: 'NONE' }, 3, 'NONE', 'NONE');
    expect(v!.buff).toBe('NONE');
  });
  it('직전과 다른 카드는 유지', () => {
    const v = validateDirective({ ...ok, buff: 'SWIFT' }, 3, 'NONE', 'TOUGH');
    expect(v!.buff).toBe('SWIFT');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/validator.test.ts`
Expected: FAIL — `buffCostOf` is not a function / buff 관련 케이스 실패

- [ ] **Step 3: 계약에 카드 추가** — `src/contracts/directive.ts`

`MUTATIONS` 상수 바로 아래에 추가:
```ts
export const BUFF_CARDS = ['NONE', 'TOUGH', 'SWIFT', 'RELENTLESS', 'RAPID_FIRE', 'MARKSMAN', 'VOLATILE'] as const;
```
`Mutation` 타입 아래에 추가:
```ts
export type BuffCard = (typeof BUFF_CARDS)[number];
```
`DirectiveSchema`에 필드 추가(`mutation` 아래 줄):
```ts
  buff: z.enum(BUFF_CARDS),
```
`ELITE_MULT` 아래에 추가:
```ts
/** 강화 카드 비용 = 해당 웨이브 예산의 25%(반올림). NONE은 0. (스펙 §3.4.1) */
export const BUFF_COST_RATIO = 0.25;
```
`DIRECTIVE_JSON_SCHEMA`의 `properties`에 `mutation` 항목 다음으로 추가하고, `required` 배열에도 `'buff'`를 넣는다:
```ts
    buff: { type: 'string', enum: [...BUFF_CARDS] },
```

- [ ] **Step 4: 검증기 구현** — `src/director/validator.ts` 전문을 아래로 교체

```ts
import {
  Directive, DirectiveSchema, Mutation, Composition, BuffCard,
  ENEMY_COST, ELITE_MULT, BUFF_COST_RATIO,
} from '../contracts/directive';

export function budgetFor(wave: number): number {
  return 8 + wave * 4 + Math.max(0, wave - 5) * 12;
}

export function costOf(c: Composition): number {
  return c.count * ENEMY_COST[c.type] * (c.elite ? ELITE_MULT : 1);
}

/** 강화 카드 비용 — 해당 웨이브 예산의 25%(반올림). NONE은 0. */
export function buffCostOf(card: BuffCard, wave: number): number {
  return card === 'NONE' ? 0 : Math.round(budgetFor(wave) * BUFF_COST_RATIO);
}

export function validateDirective(
  raw: unknown,
  wave: number,
  prevMutation: Mutation,
  prevBuff: BuffCard,
): Directive | null {
  const parsed = DirectiveSchema.safeParse(raw);
  if (!parsed.success) return null;
  const d = parsed.data;
  const total = d.composition.reduce((s, c) => s + costOf(c), 0) + buffCostOf(d.buff, wave);
  if (total > budgetFor(wave)) return null;

  const mutation: Mutation = d.mutation !== 'NONE' && d.mutation === prevMutation ? 'NONE' : d.mutation;
  const buff: BuffCard = d.buff !== 'NONE' && d.buff === prevBuff ? 'NONE' : d.buff;
  return { ...d, mutation, buff };
}
```

- [ ] **Step 5: 호출부 시그니처 정리** — `src/director/client.ts`

`requestDirective`의 시그니처에 `prevBuff: BuffCard`를 마지막 인자로 추가하고, 내부의 `validateDirective(body.directive, wave, prevMutation)` 호출을 `validateDirective(body.directive, wave, prevMutation, prevBuff)`로 바꾼다. `BuffCard`를 contracts에서 import한다. `pickFallback(wave, prevMutation)` 호출은 그대로 둔다(뱅크는 buff를 쓰지 않는다).

- [ ] **Step 6: 뱅크에 필드 추가 후 통과 확인**

`buff`가 `DirectiveSchema`의 **필수 필드**가 되었으므로 `src/director/fallbackBank.ts`의 `OPENING_WAVE`와 `BANK[2]`~`BANK[7]`의 **19개 항목 전부**에 `buff: 'NONE',`을 추가해야 타입 체크가 통과한다. 이 태스크에서 반드시 처리한다(Task 3은 그 결과를 테스트로 고정할 뿐이다).

Run: `npx tsc --noEmit` → 클린 (누락된 항목이 있으면 여기서 잡힌다)
Run: `npx vitest run` → 전체 통과
Run: `bash scripts/ai_harness.sh --fast` → `HARNESS RESULT: PASS`

- [ ] **Step 7: 커밋**

```bash
git add -A && git commit -m "feat: 디렉티브에 강화 카드 필드 — 계약·검증기·예산 합산·2연속 금지

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: buffs 모듈 + 엔티티 적용

**Files:**
- Create: `src/game/buffs.ts`, `tests/buffs.test.ts`
- Modify: `src/game/entities.ts`

**Interfaces:**
- Consumes: `BuffCard`(Task 1), `ENEMY_DEF`·`ELITE_HP_MULT`·`ELITE_SPEED_MULT`·`SHOOTER_KEEP_DISTANCE`·`SHOOTER_FIRE_INTERVAL_MS`(기존 entities.ts)
- Produces:
  - `setActiveBuff(card: BuffCard): void`, `clearBuff(): void`, `getActiveBuff(): BuffCard`
  - `buffedHp(type: EnemyType, baseHp: number): number`
  - `buffedSpeed(type: EnemyType, baseSpeed: number): number`
  - `buffedFireInterval(base: number): number`
  - `buffedKeepDistance(base: number): number`
  - `buffedBulletSpeed(base: number): number`
  - `buffedSplitCount(): number`

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/buffs.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  setActiveBuff, clearBuff, getActiveBuff,
  buffedHp, buffedSpeed, buffedFireInterval, buffedKeepDistance, buffedBulletSpeed, buffedSplitCount,
} from '../src/game/buffs';

beforeEach(() => clearBuff());

describe('활성 카드 상태', () => {
  it('기본은 NONE, 설정·해제가 반영된다', () => {
    expect(getActiveBuff()).toBe('NONE');
    setActiveBuff('TOUGH');
    expect(getActiveBuff()).toBe('TOUGH');
    clearBuff();
    expect(getActiveBuff()).toBe('NONE');
  });
});

describe('TOUGH — 전 적 HP +1', () => {
  it('모든 타입에 +1', () => {
    setActiveBuff('TOUGH');
    expect(buffedHp('chaser', 2)).toBe(3);
    expect(buffedHp('shooter', 3)).toBe(4);
    expect(buffedHp('splitter', 3)).toBe(4);
  });
  it('elite 배수가 이미 적용된 값에도 +1', () => {
    setActiveBuff('TOUGH');
    expect(buffedHp('chaser', 6)).toBe(7);
  });
  it('이속은 건드리지 않는다', () => {
    setActiveBuff('TOUGH');
    expect(buffedSpeed('chaser', 90)).toBe(90);
  });
});

describe('SWIFT — 전 적 이속 +25%', () => {
  it('모든 타입에 ×1.25', () => {
    setActiveBuff('SWIFT');
    expect(buffedSpeed('chaser', 90)).toBeCloseTo(112.5);
    expect(buffedSpeed('shooter', 60)).toBeCloseTo(75);
  });
  it('HP는 건드리지 않는다', () => {
    setActiveBuff('SWIFT');
    expect(buffedHp('chaser', 2)).toBe(2);
  });
});

describe('RELENTLESS — chaser만 이속 +45%·HP −1', () => {
  it('chaser에만 적용된다', () => {
    setActiveBuff('RELENTLESS');
    expect(buffedSpeed('chaser', 90)).toBeCloseTo(130.5);
    expect(buffedHp('chaser', 2)).toBe(1);
    expect(buffedSpeed('shooter', 60)).toBe(60);
    expect(buffedHp('shooter', 3)).toBe(3);
  });
  it('HP는 1 미만으로 내려가지 않는다', () => {
    setActiveBuff('RELENTLESS');
    expect(buffedHp('chaser', 1)).toBe(1);
  });
});

describe('RAPID_FIRE / MARKSMAN — shooter 계열', () => {
  it('RAPID_FIRE는 발사 간격 ×0.6', () => {
    setActiveBuff('RAPID_FIRE');
    expect(buffedFireInterval(1600)).toBeCloseTo(960);
    expect(buffedKeepDistance(260)).toBe(260);
  });
  it('MARKSMAN은 유지거리 +80·탄속 ×1.5', () => {
    setActiveBuff('MARKSMAN');
    expect(buffedKeepDistance(260)).toBe(340);
    expect(buffedBulletSpeed(300)).toBeCloseTo(450);
    expect(buffedFireInterval(1600)).toBe(1600);
  });
});

describe('VOLATILE — 분열 수', () => {
  it('기본 2, VOLATILE이면 3', () => {
    expect(buffedSplitCount()).toBe(2);
    setActiveBuff('VOLATILE');
    expect(buffedSplitCount()).toBe(3);
  });
});

describe('NONE — 아무것도 바꾸지 않는다', () => {
  it('모든 조회가 기본값 그대로', () => {
    expect(buffedHp('chaser', 2)).toBe(2);
    expect(buffedSpeed('chaser', 90)).toBe(90);
    expect(buffedFireInterval(1600)).toBe(1600);
    expect(buffedKeepDistance(260)).toBe(260);
    expect(buffedBulletSpeed(300)).toBe(300);
    expect(buffedSplitCount()).toBe(2);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/buffs.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: buffs.ts 구현**

```ts
import { BuffCard, EnemyType } from '../contracts/directive';

/** 활성 강화 카드. 웨이브마다 setActiveBuff로 설정하고 웨이브 종료 시 clearBuff로 초기화한다(누적 금지). */
let active: BuffCard = 'NONE';

export function setActiveBuff(card: BuffCard): void {
  active = card;
}

export function clearBuff(): void {
  active = 'NONE';
}

export function getActiveBuff(): BuffCard {
  return active;
}

/** elite 배수까지 적용된 HP에 카드 효과를 얹는다. 최소 1 보장. */
export function buffedHp(type: EnemyType, baseHp: number): number {
  if (active === 'TOUGH') return baseHp + 1;
  if (active === 'RELENTLESS' && type === 'chaser') return Math.max(1, baseHp - 1);
  return baseHp;
}

/** elite 배수까지 적용된 이속에 카드 효과를 얹는다. mutation(SPEED_SURGE)은 매 프레임 별도 적용된다. */
export function buffedSpeed(type: EnemyType, baseSpeed: number): number {
  if (active === 'SWIFT') return baseSpeed * 1.25;
  if (active === 'RELENTLESS' && type === 'chaser') return baseSpeed * 1.45;
  return baseSpeed;
}

export function buffedFireInterval(base: number): number {
  return active === 'RAPID_FIRE' ? base * 0.6 : base;
}

export function buffedKeepDistance(base: number): number {
  return active === 'MARKSMAN' ? base + 80 : base;
}

export function buffedBulletSpeed(base: number): number {
  return active === 'MARKSMAN' ? base * 1.5 : base;
}

export function buffedSplitCount(): number {
  return active === 'VOLATILE' ? 3 : 2;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/buffs.test.ts` → PASS

- [ ] **Step 5: 엔티티에 적용** — `src/game/entities.ts`

상단에 import 추가(적탄 속도는 `ArenaScene`이 담당하므로 여기서는 4개만):
```ts
import { buffedHp, buffedSpeed, buffedFireInterval, buffedKeepDistance } from './buffs';
```

`Enemy.spawn()`의 HP·이속 두 줄을 조회 함수로 감싼다:
```ts
    this.hp = opts?.hpOverride ?? buffedHp(type, elite ? def.hp * ELITE_HP_MULT : def.hp);
    this.moveSpeed = buffedSpeed(type, elite ? def.speed * ELITE_SPEED_MULT : def.speed);
```
(`hpOverride`는 splitter 소형 스폰용이다. `??`의 왼쪽이 우선이므로 소형은 항상 HP 1로 유지되고 버프가 닿지 않는다 — 의도된 동작이다.)

`updateShooter()`의 본문에서 거리·간격 상수를 지역 변수로 뽑아 조회 함수를 통과시킨다. 아래가 교체 후 전문이다:

```ts
  private updateShooter(
    time: number,
    player: Player,
    fireEnemyBullet: (x: number, y: number, angle: number, sourceType: EnemyType) => void,
  ) {
    const dist = Phaser.Math.Distance.Between(this.x, this.y, player.x, player.y);
    const angleToPlayer = Phaser.Math.Angle.Between(this.x, this.y, player.x, player.y);
    const keep = buffedKeepDistance(SHOOTER_KEEP_DISTANCE);

    if (dist < keep - SHOOTER_DEADZONE) {
      this.scene.physics.velocityFromRotation(angleToPlayer + Math.PI, this.moveSpeed, this.body.velocity);
    } else if (dist > keep + SHOOTER_DEADZONE) {
      this.scene.physics.velocityFromRotation(angleToPlayer, this.moveSpeed, this.body.velocity);
    } else {
      this.body.setVelocity(0, 0);
    }
    this.setRotation(angleToPlayer);

    if (time - this.lastFireAt >= buffedFireInterval(SHOOTER_FIRE_INTERVAL_MS)) {
      this.lastFireAt = time;
      fireEnemyBullet(this.x, this.y, angleToPlayer, 'shooter');
    }
  }
```

값을 매 프레임 새로 조회한다(모듈 상단 캐싱 금지) — 웨이브마다 카드가 바뀌기 때문이다.

- [ ] **Step 6: 검증 + 커밋**

Run: `npx tsc --noEmit` → 클린
Run: `bash scripts/ai_harness.sh --fast` → PASS

```bash
git add -A && git commit -m "feat: 강화 카드 효과 모듈 + 엔티티 스탯 적용

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 실행기 연결 + 뱅크 + 프록시

**Files:**
- Modify: `src/game/waveRunner.ts`, `src/game/scenes/ArenaScene.ts`, `src/director/fallbackBank.ts`, `supabase/functions/director/index.ts`
- Test: `tests/fallbackBank.test.ts`

**Interfaces:**
- Consumes: `setActiveBuff`·`clearBuff`·`buffedSplitCount`(Task 2), `BuffCard`(Task 1)
- Produces: ArenaScene의 `prevBuff: BuffCard` 필드 (다음 웨이브 검증에 쓰인다)

- [ ] **Step 1: 뱅크 테스트 보강** — `tests/fallbackBank.test.ts`에 추가

```ts
import { BUFF_CARDS } from '../src/contracts/directive';

describe('폴백 뱅크의 강화 카드', () => {
  it('오프닝과 전 웨이브 뱅크 항목이 모두 NONE이다', () => {
    expect(OPENING_WAVE.buff).toBe('NONE');
    for (let w = 2; w <= 7; w++) {
      for (let i = 0; i < 30; i++) {
        expect(pickFallback(w, 'NONE').buff).toBe('NONE');
      }
    }
  });
  it('BUFF_CARDS의 첫 항목은 NONE이다(기본값 계약)', () => {
    expect(BUFF_CARDS[0]).toBe('NONE');
  });
});
```

- [ ] **Step 2: 통과 확인** — Task 1 Step 6에서 19항목에 `buff: 'NONE'`을 이미 넣었으므로 이 테스트는 바로 통과해야 한다. 실패한다면 누락된 항목이 있다는 뜻이니 채운다.

Run: `npx vitest run tests/fallbackBank.test.ts` → PASS

- [ ] **Step 3: 웨이브 실행기 연결** — `src/game/waveRunner.ts`

`import { setActiveBuff, clearBuff } from './buffs';`를 추가하고, `runDirective(scene, d)` 안에서 mutation을 적용하는 자리 바로 옆에 `setActiveBuff(d.buff);`를 넣는다. `clearMutation(scene)` 안에서는 `clearBuff();`를 호출한다 — 웨이브 종료 시 mutation과 buff가 함께 초기화되어 누적이 구조적으로 불가능해진다.

- [ ] **Step 4: 씬 연결** — `src/game/scenes/ArenaScene.ts`

1. `import { BuffCard } from '../../contracts/directive';`와 `import { buffedSplitCount, buffedBulletSpeed } from '../buffs';` 추가.
2. `prevMutation` 필드 옆에 `prevBuff: BuffCard = 'NONE';`를 선언하고, `create()`의 상태 초기화 자리(`this.lastDirective = OPENING_WAVE;` 근처)에서 `this.prevBuff = 'NONE';`으로 리셋한다 — 리스타트 안전성. 기존 `prevMutation` 초기화와 같은 자리다.
3. `requestDirective(log, nextWave, this.prevMutation)` 호출에 마지막 인자로 `this.prevBuff`를 추가한다.
4. 그 `.then()` 안에서 `this.prevMutation`을 갱신하는 줄 옆에 `this.prevBuff = directive.buff;`를 추가한다.
5. `fireEnemyBullet`의 탄속에 버프를 적용한다. 적탄을 쏘는 것은 shooter뿐이라 타입 분기는 불필요하다:
```ts
    b.fire(x, y, angle, buffedBulletSpeed(ENEMY_BULLET_SPEED), 1, 0, false, sourceType);
```
6. splitter 분열(`onEnemyDeath`의 `if (wasSplit)` 블록)을 균등 분배로 바꾼다. `n=2`일 때 각도가 `base`와 `base+π`가 되어 **기존의 대칭 배치와 완전히 동일**하다 — 회귀 없음:
```ts
    if (wasSplit) {
      // 분열 위치: 임의 축 위 균등 분배 오프셋(VOLATILE이면 3기)
      const base = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const offset = ENEMY_DEF.splitter.size;
      const n = buffedSplitCount();
      for (let i = 0; i < n; i++) {
        const a = base + (Math.PI * 2 * i) / n;
        this.spawnMiniSplitter(x + Math.cos(a) * offset, y + Math.sin(a) * offset);
      }
    }
```

- [ ] **Step 5: 프록시 갱신** — `supabase/functions/director/index.ts`

1. `DIRECTIVE_JSON_SCHEMA` 사본에 `buff` 항목을 추가하고 `required`에도 넣는다 — `src/contracts/directive.ts`의 것과 **정확히 일치**해야 한다:
```ts
    buff: { type: 'string', enum: ['NONE', 'TOUGH', 'SWIFT', 'RELENTLESS', 'RAPID_FIRE', 'MARKSMAN', 'VOLATILE'] },
```
2. `SYSTEM` 프롬프트의 규칙 목록에 아래를 추가한다(기존 문구는 유지):
```
- buff는 적의 성능을 조정하는 강화 카드다. 로그에서 관찰된 플레이어의 강점을 무력화하는 카드를 골라라:
    TOUGH(전 적 HP +1) — 명중률이 높을 때
    SWIFT(전 적 이속 +25%) — 클리어 시간이 길고 거리를 벌리며 놀 때
    RELENTLESS(chaser 이속 +45%, HP -1) — 대시를 남용할 때
    RAPID_FIRE(shooter 발사 간격 40% 단축) — 피격이 적고 탄을 잘 피할 때
    MARKSMAN(shooter 탄속 +50%, 유지거리 +80) — 벽에 붙지 않고 원거리 안전지대를 쓸 때
    VOLATILE(splitter 분열 2->3기) — 분열형 처치가 많고 물량 처리가 능숙할 때
    NONE — 강화 없이 구성만으로 압박할 때
- 강화 카드는 비용이 든다: NONE이 아니면 예산의 25%가 차감되므로 적 수를 그만큼 줄여야 한다.
- 직전 웨이브와 같은 카드는 고르지 마라.
- intent에 그 카드를 고른 근거(플레이어의 어떤 강점을 노렸는지)를 써라.
```
3. 사용자 메시지 템플릿에 직전 카드를 알려주는 부분을 추가한다: 기존 `직전 mutation: ${prevMutation}.` 뒤에 `직전 buff: ${prevBuff}.`를 붙이고, 요청 본문에서 `prevBuff`를 받는다. 클라이언트(`client.ts`)도 요청 본문에 `prevBuff`를 실어 보내도록 함께 수정한다.

- [ ] **Step 6: 검증 + 커밋**

Run: `bash scripts/ai_harness.sh --full` → PASS
Run: `deno check --node-modules-dir=none supabase/functions/director/index.ts` (실패 시 리포트에 명시)

**dev 훅 `__setBuff` 추가** *(플랜 개정 2026-08-05 — 임시 훅 후 제거 → 영구 dev 훅으로 변경)*: 카드를 강제 적용하는 훅을 dev 전용으로 **영구 노출**한다. 이유는 둘이다 — (1) 승제의 밸런싱 세션에서 카드 7종을 각각 체감하려면 강제 수단이 필요한데, 없으면 디렉터가 그 카드를 고를 때까지 기다려야 한다. (2) "확인 후 제거"는 제거를 잊으면 프로덕션이 오염되는 절차 의존 방어다.

기존 dev 훅과 **동일한 가드 규칙**을 따를 것 — 호출부뿐 아니라 **메서드/함수 본문까지** `import.meta.env.DEV`로 감싼다. 콜사이트만 가드하면 클래스 프라이빗 메서드의 본문 문자열이 트리쉐이킹되지 않아 프로덕션 번들에 남는다(이 프로젝트에서 실제로 겪은 회귀다).

```ts
    if (import.meta.env.DEV) {
      (window as any).__setBuff = (card: BuffCard) => {
        setActiveBuff(card);
        console.log('[dev] buff =', card);
      };
    }
```

라이브 확인(dev 서버 + Chrome, `window.__game.loop.step()`로 프레임 수동 전진)은 **컨트롤러가 직접 수행**한다 — 구현 에이전트는 코드와 하네스까지만 책임진다.

```bash
git add -A && git commit -m "feat: 강화 카드 실행 연결 + 프록시 프롬프트·스키마

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: 제출 문서 갱신

**Files:**
- Modify: `docs/submission/ai-tech.html` → 재생성 `docs/submission/AI활용기술문서.pdf`

**Interfaces:** Consumes: Task 1~3의 확정된 계약·프롬프트

- [ ] **Step 1: 문서 3곳 갱신**

1. **1.2 입출력 계약** — 디렉티브 JSON 예시에 `"buff": "NONE|TOUGH|SWIFT|RELENTLESS|RAPID_FIRE|MARKSMAN|VOLATILE"` 줄을 추가한다.
2. **1.3 시스템 프롬프트 전문** — `supabase/functions/director/index.ts`의 갱신된 SYSTEM 상수를 **다시 글자 단위로 복사**한다. 요약·의역 금지(공고가 "주요 프롬프트 및 지시 사항"을 요구한다).
3. **1.4 권한 경계** — 표에 강화 카드 행을 추가한다: 어휘 7종 enum·비용 25% 차감·2연속 금지·웨이브 종료 초기화. 그리고 "디렉터는 구성뿐 아니라 성능도 조정하되, 수치는 정하지 못하고 카드만 고른다"는 한 문장을 본문에 넣는다.

- [ ] **Step 2: PDF 재생성**

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu --no-sandbox \
  --print-to-pdf="docs/submission/AI활용기술문서.pdf" --no-pdf-header-footer \
  "file:///Users/byseungje/projects/directors-cut/docs/submission/ai-tech.html"
```

- [ ] **Step 3: 육안 검증** — Read 도구로 PDF 전 페이지를 열어 확인한다: 한글 깨짐, 표 잘림, 페이지 넘침, 프롬프트 인용이 소스와 일치하는지. 페이지 수가 늘었다면 레이아웃이 깨지지 않았는지 본다.

- [ ] **Step 4: 커밋**

```bash
git add -A && git commit -m "docs: 기술문서에 강화 카드 반영 — 계약·프롬프트 전문·권한 경계

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## 완료 기준

1. 유닛 테스트 전량 통과(기존 35 + buffs 신규 + validator 보강 + 뱅크 보강), 하네스 `--full` PASS.
2. 프록시 JSON Schema 사본이 `src/contracts/directive.ts`와 필드·enum 단위로 일치.
3. 오프라인(폴백) 상태에서 7웨이브 완주가 여전히 가능하고 콘솔 오류 0.
4. 카드별 효과가 실제 게임 값에 반영됨을 라이브로 확인(HP·이속·분열 수 중 최소 3종).
5. 웨이브 종료 시 카드가 초기화되어 누적되지 않음을 확인.
6. 기술문서의 프롬프트 인용이 소스와 글자 단위로 일치하고 PDF가 정상 렌더.
7. 프로덕션 번들에 dev 훅 문자열 6종이 여전히 0건(회귀 없음).

## 리스크

- **밸런스**: 카드가 들어가면 체감 난이도가 달라진다. 승제 실플레이 밸런싱은 이 플랜 완료 후에 수행한다(스펙 amendment #2에 명시).
- **계약 동기**: 프록시 스키마 사본이 어긋나면 런타임에만 드러난다 — Task 3 Step 5에서 필드 단위 대조가 필수다.
- **문서 드리프트**: 프롬프트를 바꿨는데 문서 인용을 안 고치면 심사에서 불일치가 보인다 — Task 4가 그 방어선이다.
