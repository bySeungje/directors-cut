import Phaser from 'phaser';

// 주스 이펙트 — 전부 Phaser 내장(Graphics·Tween·Camera)만 사용, 외부 에셋 없음 (브리프 Task 9 Step 3).
// 색은 전부 호출자가 넘긴다 — 이 모듈은 엔티티 팔레트(entities.ts)를 모른다(재사용 가능하게 결합도를 낮춤).

// ── 피격 카메라 흔들림 (브리프 명시 수치: 80ms · 0.008) ──────────────────
const HIT_SHAKE_MS = 80;
const HIT_SHAKE_INTENSITY = 0.008;

export function shakeOnHit(scene: Phaser.Scene): void {
  scene.cameras.main.shake(HIT_SHAKE_MS, HIT_SHAKE_INTENSITY);
}

// ── 처치 파티클: 도형 파편 6개 (브리프 명시) ──────────────────────────────
const KILL_SHARD_TEX = 'juice-kill-shard';
const KILL_SHARD_SIZE = 8;
const KILL_SHARD_COUNT = 6;
const KILL_SHARD_MIN_DIST = 22;
const KILL_SHARD_MAX_DIST = 42;
const KILL_SHARD_SPREAD_JITTER = 0.3; // 완전 균등 방사보다 약간 흐트러지게(재량 결정 — 유기적인 느낌)
const KILL_SHARD_DURATION_MS = 320;

function ensureKillShardTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(KILL_SHARD_TEX)) return;
  const g = scene.add.graphics();
  g.fillStyle(0xffffff, 1); // 흰색으로 생성 후 setTint로 호출 시점 색을 입힌다
  g.fillTriangle(KILL_SHARD_SIZE / 2, 0, KILL_SHARD_SIZE, KILL_SHARD_SIZE, 0, KILL_SHARD_SIZE);
  g.generateTexture(KILL_SHARD_TEX, KILL_SHARD_SIZE, KILL_SHARD_SIZE);
  g.destroy();
}

/** 적 사망 위치에서 도형 파편 6개가 방사형으로 튀어나가며 페이드아웃. color는 죽은 적의 색(엘리트면 레드)을 그대로 물려받는다. */
export function killBurst(scene: Phaser.Scene, x: number, y: number, color: number): void {
  ensureKillShardTexture(scene);
  for (let i = 0; i < KILL_SHARD_COUNT; i++) {
    const angle = (Math.PI * 2 * i) / KILL_SHARD_COUNT + Phaser.Math.FloatBetween(-KILL_SHARD_SPREAD_JITTER, KILL_SHARD_SPREAD_JITTER);
    const dist = Phaser.Math.FloatBetween(KILL_SHARD_MIN_DIST, KILL_SHARD_MAX_DIST);
    const shard = scene.add.image(x, y, KILL_SHARD_TEX).setTint(color).setRotation(angle);
    scene.tweens.add({
      targets: shard,
      x: x + Math.cos(angle) * dist,
      y: y + Math.sin(angle) * dist,
      alpha: 0,
      scale: 0.4,
      duration: KILL_SHARD_DURATION_MS,
      ease: 'Cubic.easeOut',
      onComplete: () => shard.destroy(),
    });
  }
}

// ── 웨이브 클리어 슬로모 (브리프 명시: timeScale 0.4→1.0, 0.5초) ──────────
const SLOWMO_FROM = 0.4;
const SLOWMO_TO = 1.0;
const SLOWMO_DURATION_MS = 500;

/** Arcade Physics World의 timeScale만 조작한다 — scene.time/tweens 자체는 건드리지 않는다.
 *  인터벌 연출(대사 타이핑 등, ui/interval.ts)이 scene.time 기반이라 함께 느려지면 안 되기 때문
 *  (이 회복 트윈 자신도 tweens 클록 기준이라 물리 슬로우다운과 무관하게 정확히 0.5초에 끝난다). */
export function waveClearSlowmo(scene: Phaser.Scene): void {
  const world = scene.physics.world;
  world.timeScale = SLOWMO_FROM;
  scene.tweens.addCounter({
    from: SLOWMO_FROM,
    to: SLOWMO_TO,
    duration: SLOWMO_DURATION_MS,
    ease: 'Sine.easeOut',
    onUpdate: (tween) => {
      world.timeScale = tween.getValue() as number;
    },
  });
}

// ── 대시 잔상 ─────────────────────────────────────────────────────────
const DASH_GHOST_COUNT = 5;
const DASH_GHOST_INTERVAL_MS = 55; // 5개 × 55ms ≈ 대시 지속시간(300ms, entities.ts DASH_DURATION_MS)에 맞춤
const DASH_GHOST_FADE_MS = 260;
const DASH_GHOST_ALPHA = 0.35;

/** 대시 시작 시 1회 호출 — 이후 대시 궤적을 따라 페이드아웃되는 잔상 5개를 스태거로 남긴다.
 *  매 프레임 스폰이 아니라 delayedCall 스태거인 이유: 대시 중 계속 호출하면 Player 쪽에 매 프레임 훅이
 *  필요해 entities.ts가 juice.ts를 알아야 한다 — 대시 "시작" 이벤트 1회만으로 궤적 잔상을 흉내낸다. */
export function dashAfterimage(scene: Phaser.Scene, sprite: Phaser.GameObjects.Sprite, color: number): void {
  for (let i = 0; i < DASH_GHOST_COUNT; i++) {
    scene.time.delayedCall(i * DASH_GHOST_INTERVAL_MS, () => {
      if (!sprite.active) return;
      const ghost = scene.add
        .image(sprite.x, sprite.y, sprite.texture.key)
        .setRotation(sprite.rotation)
        .setTint(color)
        .setAlpha(DASH_GHOST_ALPHA)
        .setDepth(sprite.depth - 1);
      scene.tweens.add({
        targets: ghost,
        alpha: 0,
        duration: DASH_GHOST_FADE_MS,
        onComplete: () => ghost.destroy(),
      });
    });
  }
}
