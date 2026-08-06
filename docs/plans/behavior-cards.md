# 행동 카드 · 핫스팟 용암 — 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. 스텝은 `- [ ]` 체크박스로 추적.

**Goal:** 추격형이 전부 플레이어 현재 위치로 직진해 한 덩어리로 수렴하는 문제를 없앤다. 플레이어가 "구석에 몰아두고 쓸어담는" 지배 전략으로 디렉터의 모든 설계를 무력화하는 것을 차단한다.

**Architecture:** 기존 강화 카드 구조(어휘 + 예산 + 결정론)를 그대로 재사용한다. 카드 어휘를 "성능"에서 "행동"으로 확장(`INTERCEPT`·`ENCIRCLE`)하고, 변주에 `LAVA_HOTSPOT`을 더한다. **핫스팟 좌표는 LLM이 정하지 않는다** — 디렉터는 어휘만 고르고 엔진이 텔레메트리 히트맵에서 결정론적으로 계산한다.

**Tech Stack:** TypeScript + zod / vitest / Phaser 4 / Deno Edge Function

## Global Constraints (스펙 §3.4.2가 SSOT)

- `INTERCEPT`: 목표점 = `플레이어 위치 + 플레이어 속도 × 0.4초`, 아레나 경계로 클램프. **완벽한 요격이 아니라 페인트가 통해야 한다.**
- `ENCIRCLE`: 적마다 고유 각도 슬롯. 플레이어 중심 반경 200px에서 시작해 **초당 25px씩** 조여든다(최소 60px).
- `LAVA_HOTSPOT`: 가장 오래 머문 지점에 반경 120px 원형 용암. 피해는 기존 용암과 동일(0.5 HP/s).
- 행동 카드도 §3.4.1 규칙을 따른다: 비용 = 예산 25%, 2연속 금지, 웨이브 종료 초기화.
- **좌표를 로그에 넣지 마라.** 디렉터에게는 `hotspotConcentration`(0~1)만 준다.
- 계약 SSOT는 `src/contracts/directive.ts`. `supabase/functions/director/index.ts`의 JSON Schema 수동 사본을 반드시 함께 갱신.
- 커밋 전 `bash scripts/ai_harness.sh --fast` PASS. 트레일러 유지. **push 금지 — 컨트롤러가 한다.**

## 파일 구조

```
src/contracts/directive.ts     수정 — BUFF_CARDS +2, MUTATIONS +1, WaveLog에 지표 2개, JSON Schema
src/telemetry/collector.ts     수정 — 히트맵·밀집도 누적, getHotspot() 노출
src/game/buffs.ts              수정 — 행동 조회 함수 + 상수
src/game/entities.ts           수정 — updateBehavior에 INTERCEPT/ENCIRCLE 분기, slotAngle 필드
src/game/mutations.ts          수정 — LAVA_HOTSPOT 셋업·판정
src/game/scenes/ArenaScene.ts  수정 — lastHotspot 보관, telemetry.tick에 적 위치 전달
supabase/functions/director/index.ts  수정 — 스키마 사본 + 프롬프트
tests/telemetry.test.ts        수정 — 지표 2종
tests/buffs.test.ts            수정 — 행동 조회 함수
docs/submission/ai-tech.html   수정 → PDF 재생성
```

---

### Task 1: 계약 확장

**Files:** Modify `src/contracts/directive.ts`
**Interfaces:** Produces — `BuffCard`에 `'INTERCEPT'|'ENCIRCLE'`, `Mutation`에 `'LAVA_HOTSPOT'`, `WaveLog.movement.hotspotConcentration: number`, `WaveLog.combat.clusterRatio: number`

- [ ] **Step 1: enum·타입 확장**

```ts
export const MUTATIONS = ['NONE', 'LAVA_LEFT', 'LAVA_RIGHT', 'LAVA_HOTSPOT', 'FOG', 'SPEED_SURGE', 'SHRINK_ARENA', 'SPAWN_STORM'] as const;
export const BUFF_CARDS = ['NONE', 'TOUGH', 'SWIFT', 'RELENTLESS', 'RAPID_FIRE', 'MARKSMAN', 'VOLATILE', 'INTERCEPT', 'ENCIRCLE'] as const;
```

`WaveLog` 인터페이스의 두 곳에 필드를 더한다:
```ts
  movement: { quadrantTime: { NW: number; NE: number; SW: number; SE: number }; wallHugRatio: number; dashCount: number; hotspotConcentration: number };
  combat: { kills: Partial<Record<EnemyType, number>>; accuracy: number; clusterRatio: number };
```

`DIRECTIVE_JSON_SCHEMA`의 `mutation`·`buff` enum 배열도 위와 **정확히 같은 순서**로 갱신한다.

- [ ] **Step 2: 타입 에러 지점 확인**

Run: `npx tsc --noEmit`
Expected: `src/telemetry/collector.ts`의 `finish()`가 새 필수 필드를 안 채워 에러. **여기서 고치지 마라 — Task 2의 일이다.** 에러 목록만 리포트에 적고 넘어간다. (테스트 픽스처가 깨지면 그건 Task 2에서 함께 처리)

- [ ] **Step 3: 커밋** (타입 에러가 남은 상태이므로 하네스는 아직 FAIL이다. Task 2와 한 커밋으로 묶어도 되고, 이 스텝을 Task 2 완료 후로 미뤄도 된다 — 구현자 판단.)

---

### Task 2: 텔레메트리 — 밀집도·핫스팟

**Files:** Modify `src/telemetry/collector.ts`, `src/game/scenes/ArenaScene.ts`; Test `tests/telemetry.test.ts`
**Interfaces:**
- Consumes: Task 1의 `WaveLog` 새 필드
- Produces: `tick(x, y, w, h, dt, enemies: {x:number,y:number}[])` (시그니처 확장), `getHotspot(): {x:number,y:number}`

- [ ] **Step 1: 실패 테스트 추가** — `tests/telemetry.test.ts`

```ts
describe('밀집도·핫스팟 지표', () => {
  const W = 960, H = 640;

  it('적이 한 점에 뭉치면 clusterRatio가 0에 가깝다', () => {
    const t = new WaveTelemetry();
    const packed = [{ x: 500, y: 300 }, { x: 502, y: 301 }, { x: 498, y: 299 }];
    for (let i = 0; i < 10; i++) t.tick(100, 100, W, H, 0.1, packed);
    const log = t.finish(2, 10, [], []);
    expect(log.combat.clusterRatio).toBeLessThan(0.05);
  });

  it('적이 사방에 흩어지면 clusterRatio가 뚜렷이 크다', () => {
    const t = new WaveTelemetry();
    const spread = [{ x: 50, y: 50 }, { x: 910, y: 50 }, { x: 50, y: 590 }, { x: 910, y: 590 }];
    for (let i = 0; i < 10; i++) t.tick(100, 100, W, H, 0.1, spread);
    const log = t.finish(2, 10, [], []);
    expect(log.combat.clusterRatio).toBeGreaterThan(0.5);
  });

  it('적이 0~1기면 밀집도를 판단할 수 없어 0을 낸다', () => {
    const t = new WaveTelemetry();
    for (let i = 0; i < 5; i++) t.tick(100, 100, W, H, 0.1, [{ x: 10, y: 10 }]);
    expect(t.finish(2, 5, [], []).combat.clusterRatio).toBe(0);
  });

  it('한 자리에 계속 있으면 hotspotConcentration이 1에 가깝다', () => {
    const t = new WaveTelemetry();
    for (let i = 0; i < 20; i++) t.tick(800, 550, W, H, 0.1, []);
    expect(t.finish(2, 20, [], []).movement.hotspotConcentration).toBeGreaterThan(0.9);
  });

  it('골고루 돌아다니면 hotspotConcentration이 낮다', () => {
    const t = new WaveTelemetry();
    const pts = [[100,100],[500,100],[900,100],[100,320],[500,320],[900,320],[100,550],[500,550],[900,550]];
    for (const [x, y] of pts) for (let i = 0; i < 3; i++) t.tick(x, y, W, H, 0.1, []);
    expect(t.finish(2, 27, [], []).movement.hotspotConcentration).toBeLessThan(0.25);
  });

  it('getHotspot이 가장 오래 머문 셀의 중심을 돌려준다', () => {
    const t = new WaveTelemetry();
    for (let i = 0; i < 3; i++) t.tick(100, 100, W, H, 0.1, []);
    for (let i = 0; i < 30; i++) t.tick(850, 580, W, H, 0.1, []);   // 우하단에 압도적으로 오래
    const h = t.getHotspot();
    expect(h.x).toBeGreaterThan(W / 2);
    expect(h.y).toBeGreaterThan(H / 2);
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/telemetry.test.ts` → FAIL

- [ ] **Step 3: collector 구현**

클래스 상단에 필드를 더한다:
```ts
  private grid: number[] = [];          // HOT_COLS × HOT_ROWS 셀별 체류 시간
  private cluster = 0;                  // 밀집도 샘플 누적(시간 가중)
  private clusterTime = 0;              // 밀집도를 잰 시간(적 2기 이상인 구간만)
  private gw = 0; private gh = 0;       // 마지막으로 본 아레나 크기(getHotspot 좌표 환산용)
```
파일 상단 상수:
```ts
const HOT_COLS = 8;
const HOT_ROWS = 6;
```

`tick`을 확장한다. **기존 인자 순서를 바꾸지 말고 뒤에만 추가**한다(호출부 최소 변경):
```ts
  tick(x: number, y: number, w: number, h: number, dt: number, enemies: { x: number; y: number }[] = []) {
    this.totalTime += dt;
    const key = `${y < h / 2 ? 'N' : 'S'}${x < w / 2 ? 'W' : 'E'}` as keyof typeof this.quad;
    this.quad[key] += dt;
    if (x < WALL_MARGIN || x > w - WALL_MARGIN || y < WALL_MARGIN || y > h - WALL_MARGIN) this.wallTime += dt;

    // 히트맵 — 플레이어가 어느 셀에 얼마나 머물렀나
    this.gw = w; this.gh = h;
    if (this.grid.length === 0) this.grid = new Array(HOT_COLS * HOT_ROWS).fill(0);
    const cx = Math.min(HOT_COLS - 1, Math.max(0, Math.floor((x / w) * HOT_COLS)));
    const cy = Math.min(HOT_ROWS - 1, Math.max(0, Math.floor((y / h) * HOT_ROWS)));
    this.grid[cy * HOT_COLS + cx] += dt;

    // 밀집도 — 적들의 중심점 대비 평균 거리를 아레나 대각선 절반으로 정규화
    if (enemies.length >= 2) {
      let sx = 0, sy = 0;
      for (const e of enemies) { sx += e.x; sy += e.y; }
      const mx = sx / enemies.length, my = sy / enemies.length;
      let sum = 0;
      for (const e of enemies) sum += Math.hypot(e.x - mx, e.y - my);
      const norm = Math.hypot(w, h) / 2;
      this.cluster += (sum / enemies.length / norm) * dt;
      this.clusterTime += dt;
    }
  }
```

`getHotspot()`을 추가한다. 아레나 크기를 아직 못 본 상태(그리드 비어 있음)면 중앙을 돌려준다:
```ts
  /** 가장 오래 머문 셀의 중심 좌표. LAVA_HOTSPOT이 쓰며, WaveLog에는 넣지 않는다(LLM에게 수치를 주지 않는다). */
  getHotspot(): { x: number; y: number } {
    if (this.grid.length === 0 || this.gw === 0) return { x: this.gw / 2, y: this.gh / 2 };
    let best = 0;
    for (let i = 1; i < this.grid.length; i++) if (this.grid[i] > this.grid[best]) best = i;
    const cx = best % HOT_COLS, cy = Math.floor(best / HOT_COLS);
    return {
      x: ((cx + 0.5) / HOT_COLS) * this.gw,
      y: ((cy + 0.5) / HOT_ROWS) * this.gh,
    };
  }
```

`finish()`의 반환에 두 지표를 더한다:
```ts
        wallHugRatio: norm(this.wallTime),
        dashCount: this.dashes,
        hotspotConcentration: this.grid.length ? norm(Math.max(...this.grid)) : 0,
      },
      combat: {
        kills: this.kills,
        accuracy: this.shots ? Math.round((this.hits / this.shots) * 100) / 100 : 0,
        clusterRatio: this.clusterTime > 0 ? Math.round((this.cluster / this.clusterTime) * 100) / 100 : 0,
      },
```

- [ ] **Step 4: 씬 연결** — `src/game/scenes/ArenaScene.ts`

1. `telemetry.tick(...)` 호출(약 151행)에 활성 적 위치를 넘긴다:
```ts
    this.telemetry.tick(
      this.player.x, this.player.y, this.scale.width, this.scale.height, dt,
      this.enemies.getChildren().filter((e) => e.active) as unknown as { x: number; y: number }[],
    );
```
2. `lastHotspot` 필드를 선언한다(`prevBuff` 옆): `lastHotspot: { x: number; y: number } | null = null;` 그리고 `create()`의 상태 초기화 자리에서 `this.lastHotspot = null;`로 리셋한다.
3. **텔레메트리를 교체하기 직전에** 핫스팟을 뽑아 보관한다. `this.telemetry.finish(...)`를 호출하는 지점(약 322행) 바로 옆에서:
```ts
    this.lastHotspot = this.telemetry.getHotspot();
```
   순서가 중요하다 — 새 `WaveTelemetry`로 교체된 뒤에 부르면 빈 그리드에서 중앙이 나온다.

- [ ] **Step 5: 통과 확인 + 커밋**

Run: `npx tsc --noEmit` → 클린 / `bash scripts/ai_harness.sh --fast` → PASS
(기존 테스트의 `WaveLog` 픽스처가 새 필수 필드 때문에 깨지면 `hotspotConcentration: 0`·`clusterRatio: 0`을 채워 고친다 — 중립값이라 검증력에 영향 없다.)

```bash
git add -A && git commit -m "feat: 텔레메트리에 밀집도·핫스팟 지표 — 디렉터의 지배전략 감지 근거

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 행동 실행 — INTERCEPT · ENCIRCLE · LAVA_HOTSPOT

**Files:** Modify `src/game/buffs.ts`, `src/game/entities.ts`, `src/game/mutations.ts`; Test `tests/buffs.test.ts`
**Interfaces:** Consumes Task 1·2. Produces: `isIntercept()`, `isEncircle()`, `encircleRadius(now)`, `setActiveBuff(card, now?)`

- [ ] **Step 1: buffs.ts에 행동 조회 추가**

```ts
export const INTERCEPT_LEAD_SEC = 0.4;
const ENCIRCLE_START_RADIUS = 200;
const ENCIRCLE_MIN_RADIUS = 60;
const ENCIRCLE_CLOSE_PER_SEC = 25;

let activatedAt = 0;

export function isIntercept(): boolean { return active === 'INTERCEPT'; }
export function isEncircle(): boolean { return active === 'ENCIRCLE'; }

/** 포위 반경 — 카드 활성 시점부터 초당 25px씩 조여든다. */
export function encircleRadius(now: number): number {
  const elapsedSec = Math.max(0, (now - activatedAt) / 1000);
  return Math.max(ENCIRCLE_MIN_RADIUS, ENCIRCLE_START_RADIUS - elapsedSec * ENCIRCLE_CLOSE_PER_SEC);
}
```
`setActiveBuff`에 활성 시각을 받되 **기본값을 둬 기존 호출부를 깨지 않는다**:
```ts
export function setActiveBuff(card: BuffCard, now = 0): void {
  active = card;
  activatedAt = now;
}
```
`clearBuff()`에서 `activatedAt = 0;`도 함께 리셋한다.

- [ ] **Step 2: 테스트 추가** — `tests/buffs.test.ts`

```ts
describe('행동 카드', () => {
  it('INTERCEPT/ENCIRCLE 판별이 배타적이다', () => {
    setActiveBuff('INTERCEPT');
    expect(isIntercept()).toBe(true);
    expect(isEncircle()).toBe(false);
    setActiveBuff('ENCIRCLE');
    expect(isIntercept()).toBe(false);
    expect(isEncircle()).toBe(true);
  });
  it('행동 카드는 스탯을 건드리지 않는다', () => {
    setActiveBuff('INTERCEPT');
    expect(buffedHp('chaser', 2)).toBe(2);
    expect(buffedSpeed('chaser', 90)).toBe(90);
    setActiveBuff('ENCIRCLE');
    expect(buffedHp('shooter', 3)).toBe(3);
    expect(buffedFireInterval(1600)).toBe(1600);
  });
  it('포위 반경이 초당 25px씩 줄고 60에서 멈춘다', () => {
    setActiveBuff('ENCIRCLE', 10_000);
    expect(encircleRadius(10_000)).toBe(200);
    expect(encircleRadius(14_000)).toBe(100);      // 4초 × 25 = 100 감소
    expect(encircleRadius(60_000)).toBe(60);       // 하한
  });
  it('clearBuff 후에는 행동 판별이 모두 false다', () => {
    setActiveBuff('ENCIRCLE', 5000);
    clearBuff();
    expect(isIntercept()).toBe(false);
    expect(isEncircle()).toBe(false);
  });
});
```
(`isIntercept`·`isEncircle`·`encircleRadius`를 import 목록에 추가할 것.)

Run: `npx vitest run tests/buffs.test.ts` → 먼저 FAIL 확인 후 GREEN.

- [ ] **Step 3: 엔티티 행동 분기** — `src/game/entities.ts`

import에 `isIntercept, isEncircle, encircleRadius, INTERCEPT_LEAD_SEC`를 더한다. `Enemy` 클래스에 필드와 정적 카운터를 추가한다:
```ts
  private slotAngle = 0;
  private static slotSeq = 0;
```
`spawn()` 안에서 배정한다(황금각으로 균등 분산 — 인접 스폰이 같은 방향을 잡지 않는다):
```ts
    this.slotAngle = (Enemy.slotSeq++ * 2.39996) % (Math.PI * 2);
```
`updateBehavior`의 chaser/splitter 분기를 교체한다:
```ts
      case 'chaser':
      case 'splitter':
        if (isEncircle()) this.updateEncircle(time, player);
        else if (isIntercept()) this.updateIntercept(player);
        else this.scene.physics.moveToObject(this, player, this.moveSpeed);
        this.setRotation(Phaser.Math.Angle.Between(this.x, this.y, player.x, player.y));
        break;
```
두 메서드를 클래스에 추가한다:
```ts
  /** 플레이어가 "가려는 곳"을 노린다. 방향을 급히 꺾으면 빗나간다 — 페인트가 통해야 한다(스펙 §3.4.2). */
  private updateIntercept(player: Player) {
    const w = this.scene.scale.width;
    const h = this.scene.scale.height;
    const tx = Phaser.Math.Clamp(player.x + player.body.velocity.x * INTERCEPT_LEAD_SEC, 0, w);
    const ty = Phaser.Math.Clamp(player.y + player.body.velocity.y * INTERCEPT_LEAD_SEC, 0, h);
    this.scene.physics.moveTo(this, tx, ty, this.moveSpeed);
  }

  /** 직진하지 않고 자기 각도 슬롯의 포위 지점으로 이동한다. 반경이 줄어들며 조여든다. */
  private updateEncircle(time: number, player: Player) {
    const r = encircleRadius(time);
    const tx = player.x + Math.cos(this.slotAngle) * r;
    const ty = player.y + Math.sin(this.slotAngle) * r;
    if (Phaser.Math.Distance.Between(this.x, this.y, tx, ty) < 8) this.body.setVelocity(0, 0);
    else this.scene.physics.moveTo(this, tx, ty, this.moveSpeed);
  }
```

- [ ] **Step 4: LAVA_HOTSPOT** — `src/game/mutations.ts`

`MutationState` 인터페이스에 `hotspot?: { x: number; y: number };`를 더하고, 파일 상단에 `const HOTSPOT_RADIUS = 120;`를 둔다.

`applyMutation`의 switch에 케이스를 추가한다:
```ts
    case 'LAVA_HOTSPOT':
      setupHotspot(scene);
      break;
```
`updateMutation`의 switch에도:
```ts
    case 'LAVA_HOTSPOT': {
      const h = state.hotspot;
      if (h) tickZoneDamage(scene, dt, Phaser.Math.Distance.Between(scene.player.x, scene.player.y, h.x, h.y) < HOTSPOT_RADIUS);
      break;
    }
```
`setupLava` 옆에 함수를 추가한다:
```ts
/** 플레이어가 가장 오래 머문 지점을 태운다. 좌표는 엔진이 텔레메트리에서 계산하며 LLM은 관여하지 않는다(스펙 §3.4.2). */
function setupHotspot(scene: ArenaScene) {
  const h = scene.lastHotspot ?? { x: scene.scale.width / 2, y: scene.scale.height / 2 };
  state!.hotspot = h;
  const g = scene.add.graphics().setDepth(ZONE_TINT_DEPTH);
  g.fillStyle(DIRECTOR_RED, ZONE_ALPHA);
  g.fillCircle(h.x, h.y, HOTSPOT_RADIUS);
  state!.disposables.push(g);
}
```

- [ ] **Step 5: 활성 시각 전달** — `src/game/waveRunner.ts`의 `setActiveBuff(d.buff)` 호출을 `setActiveBuff(d.buff, scene.time.now)`로 바꾼다. 이게 없으면 `ENCIRCLE` 반경이 항상 최소값에서 시작한다.

- [ ] **Step 6: 검증 + 커밋**

Run: `bash scripts/ai_harness.sh --full` → PASS

```bash
git add -A && git commit -m "feat: 행동 카드(INTERCEPT·ENCIRCLE) + 핫스팟 용암

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: 프록시 + 제출 문서

**Files:** Modify `supabase/functions/director/index.ts`, `docs/submission/ai-tech.html` → PDF 재생성

- [ ] **Step 1: 프록시 스키마 사본 갱신** — `src/contracts/directive.ts`와 **필드·enum·순서까지 정확히** 일치시킨다:
```ts
    mutation: { type: 'string', enum: ['NONE', 'LAVA_LEFT', 'LAVA_RIGHT', 'LAVA_HOTSPOT', 'FOG', 'SPEED_SURGE', 'SHRINK_ARENA', 'SPAWN_STORM'] },
    buff: { type: 'string', enum: ['NONE', 'TOUGH', 'SWIFT', 'RELENTLESS', 'RAPID_FIRE', 'MARKSMAN', 'VOLATILE', 'INTERCEPT', 'ENCIRCLE'] },
```

- [ ] **Step 2: 시스템 프롬프트에 대응 규칙 추가** — 기존 buff 카드 목록에 두 줄을 잇고, 그 아래 해석 규칙을 더한다:
```
    INTERCEPT(추격형이 이동 방향 앞을 예측 요격) — 적을 뭉쳐서 한 번에 쓸어담을 때
    ENCIRCLE(추격형이 포위 반경으로 흩어져 조여듦) — 한 덩어리로 몰아두고 처리할 때
- 해석 규칙: clusterRatio가 낮으면(0.3 미만) 적이 한 덩어리로 뭉쳐 있었다는 뜻이다 — 플레이어가 몰아서 쓸어담고 있다. INTERCEPT나 ENCIRCLE로 그 수렴을 깨라.
- 해석 규칙: hotspotConcentration이 높으면(0.4 초과) 한 자리에 오래 버텼다는 뜻이다 — LAVA_HOTSPOT은 그 자리를 정확히 태운다.
```

- [ ] **Step 3: 기술문서 갱신** — `docs/submission/ai-tech.html`
1. §1.2 입출력 계약: 로그 JSON 예시에 `hotspotConcentration`·`clusterRatio`를, 디렉티브 JSON의 mutation·buff enum에 새 값을 반영.
2. §1.3 시스템 프롬프트 전문: 갱신된 `SYSTEM` 상수를 **글자 단위로 다시 복사**. 요약·의역 금지.
3. §1.4 권한 경계: `LAVA_HOTSPOT` 사례를 한 문단 추가한다 — **"디렉터는 좌표를 부르지 않는다. `LAVA_HOTSPOT`이라는 의도만 고르고 실제 지점은 엔진이 히트맵에서 결정론적으로 계산한다"**. 이것이 "어휘만 주고 수치는 주지 않는다"는 이 프로젝트 논지의 가장 선명한 사례이므로 반드시 넣는다.

- [ ] **Step 4: PDF 재생성 + 육안 검증**

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu --no-sandbox \
  --print-to-pdf="docs/submission/AI활용기술문서.pdf" --no-pdf-header-footer \
  "file:///Users/byseungje/projects/directors-cut/docs/submission/ai-tech.html"
```
Read 도구로 전 페이지를 열어 한글 깨짐·표 잘림·페이지 넘침을 확인한다.

- [ ] **Step 5: 커밋**

```bash
git add -A && git commit -m "docs: 행동 카드·핫스팟 용암을 프록시 프롬프트와 기술문서에 반영

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## 완료 기준

1. 하네스 `--full` PASS, 유닛 테스트 전량 통과.
2. 프록시 JSON Schema 사본이 SSOT와 enum 단위로 일치.
3. `INTERCEPT` 활성 시 적이 플레이어 진행 방향 앞으로 이동하고, 방향 전환에 빗나간다(라이브 실측).
4. `ENCIRCLE` 활성 시 적이 뭉치지 않고 포위 링을 형성하며 조여든다(라이브 실측).
5. `LAVA_HOTSPOT`이 플레이어가 오래 머문 지점에 깔린다(라이브 실측).
6. 오프라인 폴백에서 7웨이브 완주 가능, 콘솔 오류 0.
7. 프로덕션 번들에 dev 훅 문자열 0건(회귀 없음).

## 리스크

- **`INTERCEPT`가 너무 강할 수 있다.** 0.4초 선행이 과하면 회피가 불가능해진다 — 라이브에서 체감 후 조정할 첫 번째 값이다.
- **`ENCIRCLE`은 적이 멈춰 서는 구간이 생긴다.** 링에 도달한 적이 반경 축소를 기다리며 정지하면 "AI가 멍청해 보이는" 역효과가 날 수 있다. 조임 속도(25px/s)가 그 방어선이다.
- 마감이 8/10이다. `ENCIRCLE`이 Task 3에서 예상보다 무거우면 **그것만 잘라내고** `INTERCEPT` + `LAVA_HOTSPOT`으로 간다(스펙 §3.4.2에 명시된 컷 순서).
