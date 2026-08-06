# 업그레이드 봉인 · 회피 기동 — 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** "카드만 잘 고르면 5웨이브부터 가만히 있어도 클리어"를 없앤다. 디렉터가 플레이어의 **성장 경로**에 개입하고(`deny`), 적이 **자동 조준탄을 흘린다**(`EVASIVE`).

**Architecture:** 기존 어휘 구조를 그대로 확장한다. `deny`는 다음 인터벌의 3택1 후보 풀에서 업그레이드 1종을 빼는 필드이고, `EVASIVE`는 강화 카드 어휘에 한 장 더 얹는 것이다.

**Tech Stack:** TypeScript + zod / vitest / Phaser 4 / Deno Edge Function

## Global Constraints (스펙 §3.4.3이 SSOT)

- `deny` 어휘 = `NONE` + 업그레이드 8종(**`UPGRADE_IDS`와 항목·순서 일치**). 계약이 SSOT이고 테스트가 드리프트를 막는다.
- `deny`는 **예산을 소모하지 않는다** — 적을 강하게 하는 게 아니라 플레이어의 최적 경로를 막는 것이라 축이 다르다.
- `deny` **2연속 금지**(`NONE` 제외) — 같은 것을 계속 막으면 그 업그레이드를 영영 못 얻는다. mutation·buff와 같이 `NONE`으로 강제 교체.
- 웨이브 1은 항상 `deny: 'NONE'`, `buff: 'NONE'`. 폴백 뱅크 19항목도 전부 `deny: 'NONE'`.
- `EVASIVE` 이동각 = `플레이어 방향각 + sin(시각/200 + 각도슬롯) × 0.9rad`. 비용·2연속 금지·웨이브 종료 초기화는 기존 카드 규칙과 동일(예산 25%).
- 계약 SSOT는 `src/contracts/directive.ts`. `supabase/functions/director/index.ts`의 JSON Schema 수동 사본을 **반드시 함께** 갱신.
- 커밋 전 `bash scripts/ai_harness.sh --fast` PASS. 트레일러 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. **push 금지.**

## 파일 구조

```
src/contracts/directive.ts   수정 — DENY_TARGETS·DenyTarget, BUFF_CARDS +EVASIVE, DirectiveSchema.deny, JSON Schema
src/director/validator.ts    수정 — deny 2연속 금지(비용 없음), 시그니처에 prevDeny
src/director/client.ts       수정 — prevDeny 인자·요청 본문
src/director/fallbackBank.ts 수정 — 19항목에 deny: 'NONE'
src/game/upgrades.ts         수정 — pick3(deny)
src/ui/interval.ts           수정 — pick3(directive.deny)
src/game/buffs.ts            수정 — isEvasive() + 상수
src/game/entities.ts         수정 — updateBehavior에 EVASIVE 분기, shooter 스트레이핑
src/game/scenes/ArenaScene.ts 수정 — prevDeny 필드·갱신
tests/validator.test.ts      수정 — deny 규칙
tests/upgrades.test.ts       수정 — 봉인된 업그레이드 제외
tests/buffs.test.ts          수정 — isEvasive
supabase/functions/director/index.ts  수정 — 스키마 + 프롬프트
docs/submission/ai-tech.html 수정 → PDF 재생성
```

---

### Task 1: 계약 + 봉인

**Files:** Modify `src/contracts/directive.ts`, `src/director/validator.ts`, `src/director/client.ts`, `src/director/fallbackBank.ts`, `src/game/upgrades.ts`, `src/ui/interval.ts`, `src/game/scenes/ArenaScene.ts`; Test `tests/validator.test.ts`, `tests/upgrades.test.ts`

**Interfaces:** Produces — `DENY_TARGETS`, `type DenyTarget`, `Directive.deny`, `pick3(deny?: DenyTarget)`, `validateDirective(raw, wave, prevMutation, prevBuff, prevDeny)`

- [ ] **Step 1: 실패 테스트** — `tests/upgrades.test.ts`에 추가

```ts
import { UPGRADE_IDS, pick3 } from '../src/game/upgrades';
import { DENY_TARGETS } from '../src/contracts/directive';

describe('업그레이드 봉인', () => {
  it('봉인된 업그레이드는 후보에 나오지 않는다', () => {
    for (let i = 0; i < 200; i++) {
      expect(pick3('DAMAGE_UP')).not.toContain('DAMAGE_UP');
    }
  });
  it('봉인해도 후보는 여전히 3개다', () => {
    for (let i = 0; i < 50; i++) {
      expect(pick3('PIERCE')).toHaveLength(3);
    }
  });
  it("NONE이면 아무것도 빠지지 않는다 — 전 업그레이드가 언젠가 등장한다", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) pick3('NONE').forEach((id) => seen.add(id));
    expect(seen.size).toBe(UPGRADE_IDS.length);
  });
  it('계약의 DENY_TARGETS가 UPGRADE_IDS와 동기화돼 있다', () => {
    // 계약은 별도 파일이라 타입체커가 이 일치를 보장하지 못한다 — 이 테스트가 드리프트 방어선이다.
    expect(DENY_TARGETS[0]).toBe('NONE');
    expect([...DENY_TARGETS].slice(1)).toEqual([...UPGRADE_IDS]);
  });
});
```

`tests/validator.test.ts`의 `ok` 상수에 `deny: 'NONE'`을 추가하고, 기존 `validateDirective` 호출 전부에 5번째 인자 `'NONE'`을 더한 뒤 아래를 추가:

```ts
describe('업그레이드 봉인 검증', () => {
  it('deny 필드가 없으면 거부', () => {
    const { deny, ...noDeny } = { ...ok };
    expect(validateDirective(noDeny, 3, 'NONE', 'NONE', 'NONE')).toBeNull();
  });
  it('enum 밖 값 거부', () => {
    expect(validateDirective({ ...ok, deny: 'GOD_MODE' }, 3, 'NONE', 'NONE', 'NONE')).toBeNull();
  });
  it('직전과 같은 봉인은 NONE으로 강제 교체', () => {
    const v = validateDirective({ ...ok, deny: 'PIERCE' }, 3, 'NONE', 'NONE', 'PIERCE');
    expect(v).not.toBeNull();
    expect(v!.deny).toBe('NONE');
  });
  it('직전과 다른 봉인은 유지', () => {
    const v = validateDirective({ ...ok, deny: 'MULTI_SHOT' }, 3, 'NONE', 'NONE', 'PIERCE');
    expect(v!.deny).toBe('MULTI_SHOT');
  });
  it('deny는 예산을 소모하지 않는다 — 예산 전액을 composition에 쓸 수 있다', () => {
    const full = { ...ok, composition: [{ type: 'chaser', count: 20, spawn: 'N', elite: false }], buff: 'NONE', deny: 'DAMAGE_UP' };
    expect(validateDirective(full, 3, 'NONE', 'NONE', 'NONE')).not.toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run` → FAIL

- [ ] **Step 3: 계약 확장** — `src/contracts/directive.ts`

`BUFF_CARDS`에 `'EVASIVE'`를 **맨 뒤에** 추가하고, 아래를 새로 정의한다:
```ts
/** 업그레이드 봉인 대상. `src/game/upgrades.ts`의 UPGRADE_IDS와 항목·순서가 일치해야 한다
 *  — 별도 파일이라 타입체커가 보장하지 못하므로 tests/upgrades.test.ts가 드리프트를 막는다. */
export const DENY_TARGETS = [
  'NONE', 'DAMAGE_UP', 'FIRE_RATE_UP', 'MOVE_SPEED_UP', 'HP_PLUS',
  'PIERCE', 'MULTI_SHOT', 'BULLET_SPEED_UP', 'DASH_CD_DOWN',
] as const;
export type DenyTarget = (typeof DENY_TARGETS)[number];
```
`DirectiveSchema`에 `deny: z.enum(DENY_TARGETS),`를 더하고, `DIRECTIVE_JSON_SCHEMA`의 `properties`에 `deny`와 `buff`(EVASIVE 포함)를 반영하며 `required`에 `'deny'`를 넣는다.

- [ ] **Step 4: 검증기** — `src/director/validator.ts`

`validateDirective`에 5번째 인자 `prevDeny: DenyTarget`을 추가하고, mutation·buff와 **같은 모양**으로 처리한다. **`deny`는 예산 계산에 넣지 마라**:
```ts
  const deny: DenyTarget = d.deny !== 'NONE' && d.deny === prevDeny ? 'NONE' : d.deny;
  return { ...d, mutation, buff, deny };
```

- [ ] **Step 5: 후보 풀 필터** — `src/game/upgrades.ts`

```ts
export function pick3(deny: DenyTarget = 'NONE'): UpgradeId[] {
  const pool = (UPGRADE_IDS as readonly UpgradeId[]).filter((id) => id !== deny);
  const picked: UpgradeId[] = [];
  for (let i = 0; i < 3 && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(idx, 1)[0]);
  }
  return picked;
}
```
(`DenyTarget`을 contracts에서 import. `pool`은 `filter`가 새 배열을 주므로 `splice`가 안전하다.)

- [ ] **Step 6: 연결**

1. `src/ui/interval.ts`: `pick3()` → `pick3(directive.deny)`
2. `src/director/fallbackBank.ts`: 19항목 전부에 `deny: 'NONE',`
3. `src/director/client.ts`: `requestDirective`에 `prevDeny: DenyTarget` 인자 추가 → `validateDirective`에 전달 + 프록시 요청 본문에 `prevDeny` 포함. `warmUpDirector`의 더미 본문에도 추가.
4. `src/game/scenes/ArenaScene.ts`: `prevDeny: DenyTarget = 'NONE';` 필드 선언, `create()`에서 리셋, `requestDirective(...)` 호출에 전달, `.then()`에서 `this.prevDeny = directive.deny;` 갱신 — **기존 `prevBuff` 처리와 정확히 같은 자리**.

- [ ] **Step 7: 통과 + 커밋**

Run: `npx tsc --noEmit` → 클린 / `bash scripts/ai_harness.sh --fast` → PASS

```bash
git add -- src tests && git commit -m "feat: 업그레이드 봉인 — 디렉터가 플레이어 성장 경로에 개입

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: EVASIVE 카드

**Files:** Modify `src/game/buffs.ts`, `src/game/entities.ts`; Test `tests/buffs.test.ts`

- [ ] **Step 1: 테스트** — `tests/buffs.test.ts`에 추가(`isEvasive` import 보강)

```ts
describe('EVASIVE', () => {
  it('다른 행동 카드와 배타적이다', () => {
    setActiveBuff('EVASIVE');
    expect(isEvasive()).toBe(true);
    expect(isIntercept()).toBe(false);
    expect(isEncircle()).toBe(false);
  });
  it('스탯을 건드리지 않는다', () => {
    setActiveBuff('EVASIVE');
    expect(buffedHp('chaser', 2)).toBe(2);
    expect(buffedSpeed('chaser', 90)).toBe(90);
    expect(buffedFireInterval(1600)).toBe(1600);
  });
  it('clearBuff 후 false', () => {
    setActiveBuff('EVASIVE');
    clearBuff();
    expect(isEvasive()).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인 후 buffs.ts 구현**

```ts
/** 회피 기동 — 흔들림 주기(ms)와 진폭(rad). 접근 자체는 계속하므로 무한 회피가 아니다(스펙 §3.4.3). */
export const EVASIVE_PERIOD_MS = 200;
export const EVASIVE_AMPLITUDE_RAD = 0.9;

export function isEvasive(): boolean { return active === 'EVASIVE'; }
```

- [ ] **Step 3: 엔티티 적용** — `src/game/entities.ts`

import에 `isEvasive, EVASIVE_PERIOD_MS, EVASIVE_AMPLITUDE_RAD` 추가. chaser/splitter 분기의 **맨 앞**에 EVASIVE를 둔다(다른 행동 카드와 배타적이므로 순서는 무관하나 일관성을 위해):
```ts
      case 'chaser':
      case 'splitter':
        if (isEvasive()) this.updateEvasive(time, player);
        else if (isEncircle()) this.updateEncircle(time, player);
        else if (isIntercept()) this.updateIntercept(player);
        else this.scene.physics.moveToObject(this, player, this.moveSpeed);
        this.setRotation(Phaser.Math.Angle.Between(this.x, this.y, player.x, player.y));
        break;
```
메서드 추가:
```ts
  /** 플레이어를 향해 접근하되 좌우로 흔들어 자동 조준탄을 흘린다. 각도 슬롯으로 적마다 위상이 달라
   *  서로 다른 궤도를 그린다 — 전원이 같은 위상이면 한 덩어리로 같은 곡선을 그려 의미가 없다. */
  private updateEvasive(time: number, player: Player) {
    const base = Phaser.Math.Angle.Between(this.x, this.y, player.x, player.y);
    const wobble = Math.sin(time / EVASIVE_PERIOD_MS + this.slotAngle) * EVASIVE_AMPLITUDE_RAD;
    this.scene.physics.velocityFromRotation(base + wobble, this.moveSpeed, this.body.velocity);
  }
```

`updateShooter()`의 **데드존 분기**(현재 `this.body.setVelocity(0, 0)`)도 고친다 — 멈춰 있으면 자동 조준탄을 그대로 맞기 때문이다:
```ts
    } else if (isEvasive()) {
      // 데드존 안에서도 좌우로 스트레이핑한다 — 정지 상태면 회피 카드의 의미가 없다
      const dir = Math.sin(time / EVASIVE_PERIOD_MS + this.slotAngle) >= 0 ? 1 : -1;
      this.scene.physics.velocityFromRotation(angleToPlayer + (Math.PI / 2) * dir, this.moveSpeed * 0.7, this.body.velocity);
    } else {
      this.body.setVelocity(0, 0);
    }
```

- [ ] **Step 4: 검증 + 커밋**

Run: `bash scripts/ai_harness.sh --full` → PASS

```bash
git add -- src tests && git commit -m "feat: EVASIVE 카드 — 적이 흔들며 접근해 자동 조준탄을 흘린다

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 프록시 + 문서

**Files:** Modify `supabase/functions/director/index.ts`, `docs/submission/ai-tech.html` → PDF 재생성

- [ ] **Step 1: 프록시 스키마** — `src/contracts/directive.ts`와 **enum 값·순서까지** 일치시킨다:
```ts
    buff: { type: 'string', enum: ['NONE','TOUGH','SWIFT','RELENTLESS','RAPID_FIRE','MARKSMAN','VOLATILE','INTERCEPT','ENCIRCLE','EVASIVE'] },
    deny: { type: 'string', enum: ['NONE','DAMAGE_UP','FIRE_RATE_UP','MOVE_SPEED_UP','HP_PLUS','PIERCE','MULTI_SHOT','BULLET_SPEED_UP','DASH_CD_DOWN'] },
```
`required`에 `'deny'` 추가. 사용자 메시지 템플릿에 `직전 deny: ${prevDeny}.`를 더하고 요청 본문에서 `prevDeny`를 받는다.

- [ ] **Step 2: 시스템 프롬프트** — 기존 buff 목록 끝에 한 줄, 그리고 deny 규칙을 더한다:
```
    EVASIVE(전 적이 좌우로 흔들며 접근해 자동 조준탄을 흘림) — 가만히 서서 자동 사격으로 녹일 때
- deny는 다음 업그레이드 3택에서 뺄 항목이다. upgrades 로그에서 플레이어가 반복해서 고른 축을 읽고 그 성장을 막아라.
  고를 수 있는 값: NONE, DAMAGE_UP, FIRE_RATE_UP, MOVE_SPEED_UP, HP_PLUS, PIERCE, MULTI_SHOT, BULLET_SPEED_UP, DASH_CD_DOWN.
- deny는 예산을 쓰지 않는다. 직전 웨이브와 같은 것은 고르지 마라.
- deny를 골랐다면 taunt가 그 사실을 지목해야 한다(예: "화력만 올리는군. 그 길은 막았다").
```

- [ ] **Step 3: 기술문서** — `docs/submission/ai-tech.html`
1. §1.2 디렉티브 JSON에 `deny` 줄 추가, `buff` enum에 `EVASIVE` 반영.
2. §1.3 시스템 프롬프트 전문을 갱신된 `SYSTEM` 상수에서 **글자 단위로 다시 복사**.
3. §1.4 권한 경계 표에 **업그레이드 봉인** 행을 추가한다. 여기에 한 문장을 넣어라 — **"디렉터는 적만 조종하는 것이 아니라 플레이어의 성장 경로까지 설계에 넣는다. 단 어휘는 여전히 enum이고, 무엇을 얼마나 약화시킬지는 정하지 못한다."**

- [ ] **Step 4: PDF 재생성 + 육안 검증**

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu --no-sandbox \
  --print-to-pdf="docs/submission/AI활용기술문서.pdf" --no-pdf-header-footer \
  "file:///Users/byseungje/projects/directors-cut/docs/submission/ai-tech.html"
```
Read 도구로 전 페이지 확인(한글 깨짐·표 잘림·페이지 넘침).

- [ ] **Step 5: 커밋**

```bash
git add -- supabase docs && git commit -m "docs: 업그레이드 봉인·EVASIVE를 프록시와 기술문서에 반영

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## 완료 기준

1. 하네스 `--full` PASS, 유닛 테스트 전량 통과.
2. 프록시 JSON Schema가 SSOT와 enum 단위로 일치.
3. 봉인된 업그레이드가 3택 후보에 나오지 않고, 후보는 여전히 3개다.
4. `DENY_TARGETS`와 `UPGRADE_IDS` 동기화 테스트가 존재한다.
5. `EVASIVE` 활성 시 적이 흔들며 접근하고, shooter도 데드존에서 정지하지 않는다(라이브 실측).
6. 오프라인 폴백에서 7웨이브 완주 가능, 콘솔 오류 0.
7. 프로덕션 번들에 dev 훅 문자열 0건.
8. **Edge Function 재배포** — Actions는 Pages만 배포한다. `supabase functions deploy director --project-ref rffpffpjnggpqpvvzqsv --no-verify-jwt`를 반드시 실행한다.

## 리스크

- **봉인이 짜증을 유발할 수 있다.** 8종 중 1종만 빼므로 이론상 영향은 작지만, 원하는 카드가 안 나오는 체감은 다르다. 밸런싱 세션에서 판단할 첫 항목.
- **`EVASIVE`가 너무 강할 수 있다.** 진폭 0.9rad는 실측 없이 정한 값이다 — 명중률이 과도하게 떨어지면 가장 먼저 낮출 값이다.
- 완료 기준 8(프록시 재배포)을 빠뜨리면 새 어휘가 라이브에서 **에러 없이 조용히** 안 나온다. 지난 브랜치에서 실제로 겪었다.
