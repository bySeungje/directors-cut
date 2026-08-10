import Phaser from 'phaser';
import { EnemyType } from '../contracts/directive';
import { shouldFire } from './fireRule';
import type { Deprivation } from './settlement';
import { buffedHp, buffedSpeed, buffedFireInterval, buffedKeepDistance, buffedBulletSpeed, isIntercept, isEncircle, encircleRadius, encircleClosed, INTERCEPT_MAX_LEAD_SEC, isEvasive, EVASIVE_PERIOD_MS, EVASIVE_AMPLITUDE_RAD } from './buffs';

export interface PlayerStats {
  damage: number; fireRateMs: number; moveSpeed: number; bulletSpeed: number;
  pierce: number; multishot: number; dashCooldownMs: number; maxHp: number;
}
export const BASE_STATS: PlayerStats = {
  damage: 1, fireRateMs: 280, moveSpeed: 220, bulletSpeed: 480, pierce: 0, multishot: 1, dashCooldownMs: 2000, maxHp: 5,
};

/**
 * ⚠ 이 속도들은 플레이어 이속 220과의 **비율**이 전부다.
 *
 * 2026-08-08 실측(승제, 7웨이브 2회 클리어에 피격 1): 90 대 220은 2.4배 차이라 추격형이 움직이는
 * 플레이어를 **원리적으로** 못 잡는다. 물량을 아무리 늘려도 그냥 지나쳐 갈 뿐이라, 예산 곡선을
 * 올리는 것으로는 이 문제가 고쳐지지 않는다(못 잡는 적이 많아질 뿐이다).
 *
 * 125로 올려도 여전히 플레이어가 빠르다(1.76배) — 도망은 되지만 **방향을 꺾을 때마다 거리가 줄어든다.**
 * 강화 카드 상한도 확인: RELENTLESS(×1.45) 적용 시 181, elite(×1.15) 적용 시 144로 둘 다 220 미만이라
 * "따라잡혀서 아무것도 못 함"은 발생하지 않는다.
 */
export const ENEMY_DEF: Record<EnemyType, { hp: number; speed: number; size: number }> = {
  chaser:   { hp: 2, speed: 125, size: 14 },
  shooter:  { hp: 3, speed: 60,  size: 15 },
  splitter: { hp: 3, speed: 100, size: 16 },
};

// 적탄 이동속도 — 브리프에 수치 없음. 플레이어 기본 탄속(480)보다 느리게 잡아 회피 가능하게 함(재량 결정).
/** 적 탄속. 220은 플레이어 이속과 **정확히 같아서**, 선행 조준을 넣어도 방향만 바꾸면 무조건 빠졌다.
 *  320이면 선행이 의미를 갖되 급선회로는 여전히 흘릴 수 있다(2026-08-08 재설계). */
export const ENEMY_BULLET_SPEED = 320;

/** shooter 선행 조준 상한(초). 행동 카드의 INTERCEPT와 같은 사고 — 멀수록 더 앞을 보되 과예측은 막는다. */
const SHOOTER_LEAD_MAX_SEC = 0.9;
/** 선행 조준에 섞는 오차(rad). 완벽한 예측이 아니라 **페인트가 통하는 수준**이 설계 의도다. */
const SHOOTER_AIM_JITTER_RAD = 0.10;

// ── 비주얼 상수 (스펙 3.5: 무채색 엔티티, 레드는 디렉터/엘리트 전용) ─────────
// PLAYER_COLOR/ENEMY_COLOR/ELITE_COLOR는 export도 한다 — juice.ts의 킬 파편·대시 잔상 틴트가
// 여기 팔레트를 그대로 물려받아야 색이 갈라지지 않는다(Task 9).
export const PLAYER_COLOR = 0xe8e8ec;
export const ENEMY_COLOR = 0x9a9aa8;
export const ELITE_COLOR = 0xff2d2d;
const ELITE_SCALE = 1.4;
const ELITE_HP_MULT = 3;
const ELITE_SPEED_MULT = 1.15; // 스펙 3.3 "이속 소폭↑" — 브리프 누락분 반영(Task 10 밸런싱에서 조정 가능)

const PLAYER_TEX = 'player';
const PLAYER_TEX_SIZE = 40;
const PLAYER_RADIUS = 11;

const ENEMY_TEX: Record<EnemyType, string> = {
  chaser: 'enemy-chaser', shooter: 'enemy-shooter', splitter: 'enemy-splitter',
};
const ENEMY_TEX_SIZE: Record<EnemyType, number> = { chaser: 40, shooter: 46, splitter: 44 };

const BULLET_PLAYER_TEX = 'bullet-player';
const BULLET_ENEMY_TEX = 'bullet-enemy';
const BULLET_PLAYER_TEX_SIZE = 12;
const BULLET_PLAYER_RADIUS = 4;
const BULLET_ENEMY_TEX_SIZE = 14;
const BULLET_ENEMY_RADIUS = 5;

export const HUD_HEART_TEX = 'hud-heart';
const HUD_HEART_TEX_SIZE = 22;
const HUD_HEART_RADIUS = 8;

// ── 튜닝 상수 (브리프 명시 수치) ────────────────────────────────────────
const DASH_DURATION_MS = 300;
const DASH_SPEED_MULT = 3;
const HIT_INVULN_MS = 1000;
const BLINK_INTERVAL_MS = 80;
const MULTISHOT_SPREAD_DEG = 12;
const SHOOTER_KEEP_DISTANCE = 260;
const SHOOTER_FIRE_INTERVAL_MS = 1600;
// shooter 거리유지 데드존 — 브리프에 수치 없음. 목표거리 근방에서 미세 진동(jitter) 방지용(재량 결정).
const SHOOTER_DEADZONE = 15;
const BULLET_LIFETIME_MS = 1500;

// ── 텍스처 생성 (Graphics.generateTexture — 에셋 파일 0개) ────────────────

function drawHexagon(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number) {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const a = Phaser.Math.DegToRad(i * 60);
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  for (let i = 0; i < 6; i++) {
    const p1 = pts[i], p2 = pts[(i + 1) % 6];
    g.fillTriangle(cx, cy, p1.x, p1.y, p2.x, p2.y);
  }
}

function drawDiamond(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number) {
  g.fillTriangle(cx, cy - r, cx + r, cy, cx, cy + r);
  g.fillTriangle(cx, cy - r, cx - r, cy, cx, cy + r);
}

function drawHeart(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number) {
  g.fillCircle(cx - r * 0.5, cy - r * 0.35, r * 0.55);
  g.fillCircle(cx + r * 0.5, cy - r * 0.35, r * 0.55);
  g.fillTriangle(cx - r, cy - r * 0.15, cx + r, cy - r * 0.15, cx, cy + r * 0.9);
}

/** 씬에서 한 번 호출 — Player/Enemy/Bullet/HUD가 쓰는 모든 텍스처를 생성한다. */
export function generateTextures(scene: Phaser.Scene) {
  const g = scene.add.graphics();

  // player: 원 + 조준 방향 노치(오른쪽 = rotation 0)
  g.clear();
  g.fillStyle(PLAYER_COLOR, 1);
  g.fillCircle(PLAYER_TEX_SIZE / 2, PLAYER_TEX_SIZE / 2, PLAYER_RADIUS);
  g.fillTriangle(
    PLAYER_TEX_SIZE / 2 + PLAYER_RADIUS + 7, PLAYER_TEX_SIZE / 2,
    PLAYER_TEX_SIZE / 2 + PLAYER_RADIUS - 2, PLAYER_TEX_SIZE / 2 - 6,
    PLAYER_TEX_SIZE / 2 + PLAYER_RADIUS - 2, PLAYER_TEX_SIZE / 2 + 6,
  );
  g.generateTexture(PLAYER_TEX, PLAYER_TEX_SIZE, PLAYER_TEX_SIZE);

  // chaser: 삼각(오른쪽을 향함)
  g.clear();
  g.fillStyle(ENEMY_COLOR, 1);
  {
    const s = ENEMY_DEF.chaser.size;
    const c = ENEMY_TEX_SIZE.chaser / 2;
    g.fillTriangle(c + s, c, c - s * 0.7, c - s * 0.85, c - s * 0.7, c + s * 0.85);
  }
  g.generateTexture(ENEMY_TEX.chaser, ENEMY_TEX_SIZE.chaser, ENEMY_TEX_SIZE.chaser);

  // shooter: 사각 + 작은 조준 노치(발사 방향을 읽을 수 있게 — 재량 결정)
  g.clear();
  g.fillStyle(ENEMY_COLOR, 1);
  {
    const s = ENEMY_DEF.shooter.size;
    const c = ENEMY_TEX_SIZE.shooter / 2;
    g.fillRect(c - s, c - s, s * 2, s * 2);
    g.fillTriangle(c + s + 6, c, c + s - 2, c - 5, c + s - 2, c + 5);
  }
  g.generateTexture(ENEMY_TEX.shooter, ENEMY_TEX_SIZE.shooter, ENEMY_TEX_SIZE.shooter);

  // splitter: 육각
  g.clear();
  g.fillStyle(ENEMY_COLOR, 1);
  drawHexagon(g, ENEMY_TEX_SIZE.splitter / 2, ENEMY_TEX_SIZE.splitter / 2, ENEMY_DEF.splitter.size);
  g.generateTexture(ENEMY_TEX.splitter, ENEMY_TEX_SIZE.splitter, ENEMY_TEX_SIZE.splitter);

  // 플레이어 탄
  g.clear();
  g.fillStyle(PLAYER_COLOR, 1);
  g.fillCircle(BULLET_PLAYER_TEX_SIZE / 2, BULLET_PLAYER_TEX_SIZE / 2, BULLET_PLAYER_RADIUS);
  g.generateTexture(BULLET_PLAYER_TEX, BULLET_PLAYER_TEX_SIZE, BULLET_PLAYER_TEX_SIZE);

  // 적탄 (마름모 — 사각형 shooter와 형태로 연결)
  g.clear();
  g.fillStyle(ENEMY_COLOR, 1);
  drawDiamond(g, BULLET_ENEMY_TEX_SIZE / 2, BULLET_ENEMY_TEX_SIZE / 2, BULLET_ENEMY_RADIUS);
  g.generateTexture(BULLET_ENEMY_TEX, BULLET_ENEMY_TEX_SIZE, BULLET_ENEMY_TEX_SIZE);

  // HUD 하트 (무채색 — HP는 디렉터 요소가 아니므로 레드 금지)
  g.clear();
  g.fillStyle(PLAYER_COLOR, 1);
  drawHeart(g, HUD_HEART_TEX_SIZE / 2, HUD_HEART_TEX_SIZE / 2, HUD_HEART_RADIUS);
  g.generateTexture(HUD_HEART_TEX, HUD_HEART_TEX_SIZE, HUD_HEART_TEX_SIZE);

  g.destroy();
}

// ── 헬퍼 ────────────────────────────────────────────────────────────────

/** multishot n발을 중심각 기준 ±12° 부채꼴로 배치(인접 탄 간격 12°, 재량 결정 — 브리프에 공식 없음). */
function computeMultishotAngles(center: number, n: number): number[] {
  if (n <= 1) return [center];
  const step = Phaser.Math.DegToRad(MULTISHOT_SPREAD_DEG);
  const start = -((n - 1) / 2) * step;
  const angles: number[] = [];
  for (let i = 0; i < n; i++) angles.push(center + start + i * step);
  return angles;
}

// ── Player ──────────────────────────────────────────────────────────────

type PlayerKeys = {
  W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key;
  S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key;
  SPACE: Phaser.Input.Keyboard.Key;
};

export class Player extends Phaser.Physics.Arcade.Sprite {
  declare body: Phaser.Physics.Arcade.Body;

  // stats가 먼저 초기화돼야 hp가 stats.maxHp를 읽을 수 있다(클래스 필드는 선언 순서대로 초기화된다).
  stats: PlayerStats = { ...BASE_STATS };
  hp = this.stats.maxHp;

  /** 텔레메트리 훅 — ArenaScene이 연결한다 */
  onDash?: () => void;

  private keys!: PlayerKeys;
  private dashReadyAt = 0;
  private dashActiveUntil = 0;
  private dashInvulnUntil = 0;
  private hitInvulnUntil = 0;
  private lastFireAt = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, PLAYER_TEX);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setCollideWorldBounds(true);
    const off = PLAYER_TEX_SIZE / 2 - PLAYER_RADIUS;
    this.setCircle(PLAYER_RADIUS, off, off);
    this.keys = scene.input.keyboard!.addKeys('W,A,S,D,SPACE') as unknown as PlayerKeys;
  }

  isInvulnerable(time: number): boolean {
    return time < this.dashInvulnUntil || time < this.hitInvulnUntil;
  }

  /** 피격 적용 — 무적 중이면 false(데미지 없음) */
  takeHit(time: number): boolean {
    if (this.isInvulnerable(time)) return false;
    this.hp -= 1;
    this.hitInvulnUntil = time + HIT_INVULN_MS;
    return true;
  }

  /** 업그레이드 적용(Task 8) — maxHp가 늘면 늘어난 만큼 즉시 회복한다.
   *  HP_PLUS의 "최대+1·회복+1"을 개별 업그레이드가 아니라 이 규칙으로 일반화했다: maxHp 증가분 = 회복량. */
  applyStats(newStats: PlayerStats) {
    const healedBy = Math.max(0, newStats.maxHp - this.stats.maxHp);
    this.stats = newStats;
    if (healedBy > 0) this.hp = Math.min(this.stats.maxHp, this.hp + healedBy);
  }

  /** 디렉터가 이번 웨이브 동안 가져간 능력. null이면 온전한 상태.
   *  강화가 아니라 박탈이 이 게임의 대응 방식이다(settlement.ts 참조). */
  deprivation: Deprivation = null;

  /** 대시 봉인 여부 — HUD와 handleDash가 읽는다. */
  get dashLocked(): boolean { return this.deprivation === 'DASH_LOCK'; }

  /** 박탈이 반영된 실효 발사 간격. 연사를 빼앗기면 두 배로 느려진다. */
  private effectiveFireRate(): number {
    return this.deprivation === 'SLOW_FIRE' ? this.stats.fireRateMs * 2 : this.stats.fireRateMs;
  }

  /** 박탈이 반영된 실효 동시 발사 수. 다중 발사를 빼앗기면 한 발이다. */
  private effectiveMultishot(): number {
    return this.deprivation === 'NO_MULTI' ? 1 : this.stats.multishot;
  }

  /** 0(직후)~1(사용 가능) — HUD 게이지용 */
  dashReadyFraction(time: number): number {
    if (time >= this.dashReadyAt) return 1;
    const remaining = this.dashReadyAt - time;
    return 1 - Phaser.Math.Clamp(remaining / this.stats.dashCooldownMs, 0, 1);
  }

  /** 이동·대시·조준·깜빡임 처리 후, 이번 프레임에 발사할 각도 목록(라디안)을 반환.
   *
   *  **조준·발사는 수동이다(2026-08-10).** 구 구현은 가장 가까운 적을 자동 조준하고 쿨다운마다
   *  자동 발사했다 — 그래서 탄이 빗나갈 수 없었고, `docs/_hub/nodes/C-player-needs-a-failure-axis.md`가
   *  종결한 대로 **플레이어가 부족해질 수 있는 축이 하나도 없었다**(방어는 이속 우위로, 공격은 자동
   *  조준으로 둘 다 실패 불가). 예산 곡선·적 이속·선행 조준을 세 번 당겼지만 전부 "적을 강하게" 축이라
   *  실패했다. 이 5줄이 그 원인을 제거한다.
   *
   *  적을 인자로 더 이상 보지 않는다 — 조준은 포인터가, 발사는 플레이어가 정한다. 빈 곳을 쏠 수 있고
   *  그것이 곧 실패 축이다(`sc-miss-possible`: 명중률 100% 미만이 실측으로 확인돼야 한다). */
  update(time: number, _delta: number, _enemies: Phaser.Physics.Arcade.Group): number[] {
    this.handleMovement(time);
    this.handleDash(time);
    this.handleBlink(time);

    const pointer = this.scene.input.activePointer;
    this.setRotation(Phaser.Math.Angle.Between(this.x, this.y, pointer.worldX, pointer.worldY));

    if (!shouldFire(pointer.isDown, time, this.lastFireAt, this.effectiveFireRate())) return [];
    this.lastFireAt = time;
    return computeMultishotAngles(this.rotation, this.effectiveMultishot());
  }

  private handleMovement(time: number) {
    const left = this.keys.A.isDown, right = this.keys.D.isDown, up = this.keys.W.isDown, down = this.keys.S.isDown;
    let vx = (right ? 1 : 0) - (left ? 1 : 0);
    let vy = (down ? 1 : 0) - (up ? 1 : 0);
    const len = Math.hypot(vx, vy);
    if (len > 0) { vx /= len; vy /= len; }
    const dashing = time < this.dashActiveUntil;
    const speed = this.stats.moveSpeed * (dashing ? DASH_SPEED_MULT : 1);
    this.setVelocity(vx * speed, vy * speed);
  }

  private handleDash(time: number) {
    if (this.dashLocked) return; // 읽혔다 — 이번 웨이브는 대시를 잃는다(settlement.deprivationFor)
    if (Phaser.Input.Keyboard.JustDown(this.keys.SPACE) && time >= this.dashReadyAt) {
      this.dashReadyAt = time + this.stats.dashCooldownMs;
      this.dashActiveUntil = time + DASH_DURATION_MS;
      this.dashInvulnUntil = time + DASH_DURATION_MS;
      this.onDash?.();
    }
  }

  private handleBlink(time: number) {
    const blinking = time < this.hitInvulnUntil;
    this.setVisible(blinking ? Math.floor(time / BLINK_INTERVAL_MS) % 2 === 0 : true);
  }
}

// ── Enemy ───────────────────────────────────────────────────────────────

export interface EnemySpawnOptions {
  canSplit?: boolean;
  hpOverride?: number;
  scaleOverride?: number;
}

export class Enemy extends Phaser.Physics.Arcade.Sprite {
  declare body: Phaser.Physics.Arcade.Body;

  enemyType: EnemyType = 'chaser';
  hp = 1;
  elite = false;
  /** true면 사망 시 소형 2기로 분열(splitter 원본만 — 분열 산물은 재분열하지 않음) */
  canSplit = false;

  private moveSpeed = 0;
  private lastFireAt = 0;
  /** ENCIRCLE 포위 지점의 고유 각도 슬롯 — 황금각 분산으로 인접 스폰이 같은 방향을 잡지 않는다. */
  private slotAngle = 0;
  private static slotSeq = 0;

  constructor(scene: Phaser.Scene, x: number, y: number, texture: string = ENEMY_TEX.chaser) {
    super(scene, x, y, texture);
    scene.add.existing(this);
    scene.physics.add.existing(this);
  }

  /** 풀에서 꺼낸 인스턴스를 타입/엘리트에 맞게 (재)구성한다 */
  spawn(type: EnemyType, elite: boolean, opts?: EnemySpawnOptions) {
    const def = ENEMY_DEF[type];
    const texSize = ENEMY_TEX_SIZE[type];

    this.enemyType = type;
    this.elite = elite;
    this.canSplit = opts?.canSplit ?? type === 'splitter';
    this.slotAngle = (Enemy.slotSeq++ * 2.39996) % (Math.PI * 2);

    this.setTexture(ENEMY_TEX[type]);
    const scale = opts?.scaleOverride ?? (elite ? ELITE_SCALE : 1);
    this.setScale(scale);
    const off = texSize / 2 - def.size;
    this.setCircle(def.size, off, off);

    this.hp = opts?.hpOverride ?? buffedHp(type, elite ? def.hp * ELITE_HP_MULT : def.hp);
    this.moveSpeed = buffedSpeed(type, elite ? def.speed * ELITE_SPEED_MULT : def.speed);
    this.setTint(elite ? ELITE_COLOR : 0xffffff);
    this.setAlpha(1);

    this.lastFireAt = this.scene.time.now;
    this.setActive(true).setVisible(true);
    this.body.enable = true;
    this.body.setVelocity(0, 0);
  }

  /** @returns 이 데미지로 사망하면 true */
  takeDamage(dmg: number): boolean {
    this.hp -= dmg;
    return this.hp <= 0;
  }

  updateBehavior(
    time: number,
    _delta: number,
    player: Player,
    fireEnemyBullet: (x: number, y: number, angle: number, sourceType: EnemyType) => void,
  ) {
    if (!this.active) return;

    switch (this.enemyType) {
      case 'chaser':
      case 'splitter':
        // splitter 생존 중 이동 패턴은 브리프에 명시 없음 → chaser와 동일한 분기(재량 결정, 분열은 사망 시에만 고유)
        if (isEvasive()) this.updateEvasive(time, player);
        else if (isEncircle()) this.updateEncircle(time, player);
        else if (isIntercept()) this.updateIntercept(player);
        else this.scene.physics.moveToObject(this, player, this.moveSpeed);
        this.setRotation(Phaser.Math.Angle.Between(this.x, this.y, player.x, player.y));
        break;
      case 'shooter':
        this.updateShooter(time, player, fireEnemyBullet);
        break;
    }

    if (this.elite) this.setAlpha(0.75 + 0.25 * Math.sin(time / 150)); // 발광 — 펄스로 구현(재량 결정)
  }

  /** 플레이어가 "가려는 곳"을 노린다. 방향을 급히 꺾으면 빗나간다 — 페인트가 통해야 한다(스펙 §3.4.2). */
  /** 이 적이 플레이어에게 도달하는 데 걸리는 시간만큼 앞을 내다본 지점. 고정 선행으로는 효과가 없다 —
   *  플레이어 이속 220 대 추격자 90으로 2.4배 차이라, 짧게 보면 예측이 무의미하다(스펙 §3.4.2 실측표). */
  private predictedPoint(player: Player): { x: number; y: number } {
    const dist = Phaser.Math.Distance.Between(this.x, this.y, player.x, player.y);
    const lead = Math.min(dist / this.moveSpeed, INTERCEPT_MAX_LEAD_SEC);
    return {
      x: Phaser.Math.Clamp(player.x + player.body.velocity.x * lead, 0, this.scene.scale.width),
      y: Phaser.Math.Clamp(player.y + player.body.velocity.y * lead, 0, this.scene.scale.height),
    };
  }

  private updateIntercept(player: Player) {
    const p = this.predictedPoint(player);
    this.scene.physics.moveTo(this, p.x, p.y, this.moveSpeed);
  }

  /** 직진하지 않고 자기 각도 슬롯의 포위 지점으로 이동한다. 반경이 줄어들며 조여든다. */
  private updateEncircle(time: number, player: Player) {
    if (encircleClosed(time)) {
      // 조임 완료 — 포위를 풀고 덮친다. 링 위에 계속 멈춰 있으면 적이 영원히 닿지 못한다.
      // 단 현재 위치가 아니라 예측점으로 덮쳐야 한다. moveToObject로 되돌리면 전원이 같은 점으로
      // 수렴해 이 카드가 막으려던 "뒤에 한 덩어리"가 그대로 재현된다(스펙 §3.4.2 실측: 포위면 1.25).
      const p = this.predictedPoint(player);
      this.scene.physics.moveTo(this, p.x, p.y, this.moveSpeed);
      return;
    }
    const r = encircleRadius(time);
    const p = this.predictedPoint(player); // 링 중심도 예측점 — 현재 위치 기준이면 뒤에 한 덩어리로 늘어선다
    // 링 오프셋을 더한 뒤 다시 클램프한다 — predictedPoint만 클램프하면 벽에 붙은 플레이어를 포위할 때
    // 목표점이 아레나 밖으로 나가 적이 화면 밖으로 빠진다(Enemy에는 world bounds 충돌이 없다).
    const tx = Phaser.Math.Clamp(p.x + Math.cos(this.slotAngle) * r, 0, this.scene.scale.width);
    const ty = Phaser.Math.Clamp(p.y + Math.sin(this.slotAngle) * r, 0, this.scene.scale.height);
    if (Phaser.Math.Distance.Between(this.x, this.y, tx, ty) < 8) this.body.setVelocity(0, 0);
    else this.scene.physics.moveTo(this, tx, ty, this.moveSpeed);
  }

  /** 플레이어를 향해 접근하되 좌우로 흔들어 자동 조준탄을 흘린다. 각도 슬롯으로 적마다 위상이 달라
   *  서로 다른 궤도를 그린다 — 전원이 같은 위상이면 한 덩어리로 같은 곡선을 그려 의미가 없다. */
  private updateEvasive(time: number, player: Player) {
    const base = Phaser.Math.Angle.Between(this.x, this.y, player.x, player.y);
    const wobble = Math.sin(time / EVASIVE_PERIOD_MS + this.slotAngle) * EVASIVE_AMPLITUDE_RAD;
    this.scene.physics.velocityFromRotation(base + wobble, this.moveSpeed, this.body.velocity);
  }

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
    } else if (isEvasive()) {
      // 데드존 안에서도 좌우로 스트레이핑한다 — 정지 상태면 회피 카드의 의미가 없다
      const dir = Math.sin(time / EVASIVE_PERIOD_MS + this.slotAngle) >= 0 ? 1 : -1;
      this.scene.physics.velocityFromRotation(angleToPlayer + (Math.PI / 2) * dir, this.moveSpeed * 0.7, this.body.velocity);
    } else {
      this.body.setVelocity(0, 0);
    }
    this.setRotation(angleToPlayer);

    if (time - this.lastFireAt >= buffedFireInterval(SHOOTER_FIRE_INTERVAL_MS)) {
      this.lastFireAt = time;
      fireEnemyBullet(this.x, this.y, this.aimAngle(player, dist), 'shooter');
    }
  }

  /**
   * 탄이 도착할 지점을 향해 쏜다.
   *
   * 기존에는 `angleToPlayer`(현재 위치)로 쐈다. 탄속이 플레이어 이속과 같아서, 260px 거리면 비행
   * 1.18초 동안 플레이어가 260px를 이동하는데 판정 반경은 16px이다 — **빗나가는 게 아니라 조준이
   * 성립하지 않았다.** 움직이기만 하면 shooter 전체가 무해했고, 그래서 7웨이브를 피격 1로 깰 수 있었다.
   *
   * 완벽한 요격은 만들지 않는다. 상한(0.9초)과 오차(±0.1rad)를 둬서 **급선회하면 빠지게** 한다 —
   * 행동 카드 INTERCEPT와 같은 설계 의도다(스펙 §3.4.2 "페인트가 통하는 수준").
   */
  private aimAngle(player: Player, dist: number): number {
    const speed = buffedBulletSpeed(ENEMY_BULLET_SPEED);
    const lead = Math.min(dist / speed, SHOOTER_LEAD_MAX_SEC);
    const px = Phaser.Math.Clamp(player.x + player.body.velocity.x * lead, 0, this.scene.scale.width);
    const py = Phaser.Math.Clamp(player.y + player.body.velocity.y * lead, 0, this.scene.scale.height);
    const jitter = (Math.random() - 0.5) * 2 * SHOOTER_AIM_JITTER_RAD;
    return Phaser.Math.Angle.Between(this.x, this.y, px, py) + jitter;
  }
}

// ── Bullet ──────────────────────────────────────────────────────────────

export class Bullet extends Phaser.Physics.Arcade.Sprite {
  declare body: Phaser.Physics.Arcade.Body;

  damage = 1;
  pierceRemaining = 0;
  fromPlayer = true;
  sourceType?: EnemyType;
  /** 이 탄이 한 번이라도 명중했는지 — recordShot 중복 집계 방지 가드 */
  hit = false;

  /** 명중 없이 소멸(수명/화면 밖)할 때 호출 — 플레이어 탄의 recordShot(false) 연결용 */
  onExpire?: (hit: boolean) => void;

  private expireAt = 0;

  constructor(scene: Phaser.Scene, x: number, y: number, texture: string = BULLET_PLAYER_TEX) {
    super(scene, x, y, texture);
    scene.add.existing(this);
    scene.physics.add.existing(this);
  }

  fire(
    x: number, y: number, angle: number, speed: number, damage: number, pierce: number,
    fromPlayer: boolean, sourceType?: EnemyType,
  ) {
    this.onExpire = undefined;
    const texture = fromPlayer ? BULLET_PLAYER_TEX : BULLET_ENEMY_TEX;
    const radius = fromPlayer ? BULLET_PLAYER_RADIUS : BULLET_ENEMY_RADIUS;
    const texSize = fromPlayer ? BULLET_PLAYER_TEX_SIZE : BULLET_ENEMY_TEX_SIZE;

    this.setTexture(texture);
    const off = texSize / 2 - radius;
    this.setCircle(radius, off, off);
    this.setPosition(x, y);
    this.setRotation(angle);

    this.damage = damage;
    this.pierceRemaining = pierce;
    this.fromPlayer = fromPlayer;
    this.sourceType = sourceType;
    this.hit = false;

    this.setActive(true).setVisible(true);
    this.body.enable = true;
    this.scene.physics.velocityFromRotation(angle, speed, this.body.velocity);
    this.expireAt = this.scene.time.now + BULLET_LIFETIME_MS;
  }

  preUpdate(time: number, delta: number) {
    super.preUpdate(time, delta);
    if (!this.active) return;

    const margin = 40;
    const w = this.scene.scale.width, h = this.scene.scale.height;
    const outOfBounds = this.x < -margin || this.x > w + margin || this.y < -margin || this.y > h + margin;
    if (time > this.expireAt || outOfBounds) {
      this.onExpire?.(this.hit);
      this.onExpire = undefined;
      this.setActive(false).setVisible(false);
      this.body.enable = false;
    }
  }

  /** 적중으로 소멸(관통 소진) — onExpire은 호출하지 않는다(명중은 충돌 콜백에서 이미 집계됨) */
  hideAfterHit() {
    this.onExpire = undefined;
    this.setActive(false).setVisible(false);
    this.body.enable = false;
  }
}
