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

/** 전면 레드 플래시 — 잡힘(예측됨) 연출. 카메라 flash는 흰색 기본이라 오버레이 방식. */
export function redFlash(scene: Phaser.Scene, alpha = 0.22, durationMs = 180): void {
  const { width, height } = scene.scale;
  const overlay = scene.add.rectangle(width / 2, height / 2, width, height, 0xff2d2d, alpha).setDepth(900);
  scene.tweens.add({ targets: overlay, alpha: 0, duration: durationMs, onComplete: () => overlay.destroy() });
}
