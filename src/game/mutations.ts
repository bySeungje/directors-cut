import Phaser from 'phaser';
import type { Mutation } from '../contracts/directive';
import type { Enemy } from './entities';
import type { ArenaScene } from './scenes/ArenaScene';
import { clearBuff } from './buffs';

// ── 브리프 명시 수치 (Task 6 브리프 mutation 효과표) ─────────────────────
const LAVA_DPS_PER_SEC = 0.5; // 체류 1초당 HP 0.5 누적, 1 도달 시 피격 처리
const FOG_RADIUS = 240;
const FOG_ALPHA = 0.85;
const SHRINK_RATIO = 0.12; // 아레나 경계 상하좌우 12%씩 축소
const SPEED_SURGE_MULT = 1.25; // 적 이속 +25%

// 재량 결정 — 브리프는 LAVA/SHRINK 경계를 "반투명"으로만 지정(정량값 없음). FOG(0.85)와 구분되는 값으로 선택.
const ZONE_ALPHA = 0.35;
const ZONE_TINT_DEPTH = -10; // 엔티티(기본 depth 0)보다 아래 — 스프라이트를 가리지 않는 바닥 tint로 렌더
const FOG_DEPTH = 500; // 엔티티 위·HUD(1000) 아래 — 먼 적을 실제로 가려야 하므로 위에 렌더

const DIRECTOR_RED = 0xff2d2d; // 스펙 3.5·비주얼 규약: 레드는 디렉터 개입 전용
const FOG_HOLE_TEX = 'mutation-fog-hole';

interface MutationState {
  mutation: Mutation;
  disposables: Phaser.GameObjects.GameObject[];
  /** LAVA/SHRINK 위험지대 피해 누적치 — 두 mutation은 동일 웨이브에 동시 활성화되지 않으므로 하나로 공유 */
  acc: number;
  shrinkInner: Phaser.Geom.Rectangle | null;
  fogRT: Phaser.GameObjects.RenderTexture | null;
}

let state: MutationState | null = null;

/** 웨이브 시작 시 runDirective가 호출 — 이전 상태를 먼저 정리한 뒤 새 mutation을 적용한다. */
export function applyMutation(scene: ArenaScene, mutation: Mutation): void {
  clearMutation(scene);
  if (mutation === 'NONE') return;

  state = { mutation, disposables: [], acc: 0, shrinkInner: null, fogRT: null };

  switch (mutation) {
    case 'LAVA_LEFT':
    case 'LAVA_RIGHT':
      setupLava(scene, mutation);
      break;
    case 'FOG':
      setupFog(scene);
      break;
    case 'SHRINK_ARENA':
      setupShrink(scene);
      break;
    case 'SPEED_SURGE':
    case 'SPAWN_STORM':
      break; // 시각 오버레이 없음 — SPEED_SURGE는 속도 배율로, SPAWN_STORM은 스폰 타이밍으로만 표현된다
  }
}

/** ArenaScene.update()가 매 프레임 호출 — LAVA/SHRINK 피해 누적, FOG 오버레이 추적, SPEED_SURGE 속도 배율. */
export function updateMutation(scene: ArenaScene, dt: number): void {
  if (!state) return;
  switch (state.mutation) {
    case 'LAVA_LEFT':
      tickZoneDamage(scene, dt, scene.player.x < scene.scale.width / 2);
      break;
    case 'LAVA_RIGHT':
      tickZoneDamage(scene, dt, scene.player.x >= scene.scale.width / 2);
      break;
    case 'SHRINK_ARENA':
      tickShrink(scene, dt);
      break;
    case 'FOG':
      tickFog(scene);
      break;
    case 'SPEED_SURGE':
      tickSpeedSurge(scene);
      break;
  }
}

/** 웨이브 종료 시 호출 — 시각 요소를 destroy하고 내부 상태를 리셋한다. 강화 카드도 여기서 함께 초기화한다
 *  (mutation이 NONE이라 `state`가 이미 null인 웨이브에도 clearBuff는 반드시 실행돼야 하므로 조기 return보다 앞에 둔다) —
 *  웨이브 종료 시 mutation과 buff가 함께 리셋되어 누적이 구조적으로 불가능하다. */
export function clearMutation(_scene: ArenaScene): void {
  clearBuff();
  if (!state) return;
  for (const obj of state.disposables) obj.destroy();
  state = null;
}

// ── LAVA_LEFT / LAVA_RIGHT ───────────────────────────────────────────────

function setupLava(scene: ArenaScene, mutation: 'LAVA_LEFT' | 'LAVA_RIGHT') {
  const w = scene.scale.width;
  const h = scene.scale.height;
  const half = w / 2;
  const g = scene.add.graphics().setDepth(ZONE_TINT_DEPTH);
  g.fillStyle(DIRECTOR_RED, ZONE_ALPHA);
  if (mutation === 'LAVA_LEFT') g.fillRect(0, 0, half, h);
  else g.fillRect(half, 0, half, h);
  state!.disposables.push(g);
}

// ── SHRINK_ARENA ──────────────────────────────────────────────────────────

function setupShrink(scene: ArenaScene) {
  const w = scene.scale.width;
  const h = scene.scale.height;
  const mx = w * SHRINK_RATIO;
  const my = h * SHRINK_RATIO;
  state!.shrinkInner = new Phaser.Geom.Rectangle(mx, my, w - mx * 2, h - my * 2);

  // 경계 밖(마진 4개 띠) = LAVA와 동일 판정 — 시각도 동일한 위험지대 톤으로 통일
  const g = scene.add.graphics().setDepth(ZONE_TINT_DEPTH);
  g.fillStyle(DIRECTOR_RED, ZONE_ALPHA);
  g.fillRect(0, 0, w, my); // 위
  g.fillRect(0, h - my, w, my); // 아래
  g.fillRect(0, my, mx, h - my * 2); // 왼쪽
  g.fillRect(w - mx, my, mx, h - my * 2); // 오른쪽
  state!.disposables.push(g);
}

// ── FOG ───────────────────────────────────────────────────────────────────
// GeometryMask.invertAlpha가 이 Phaser 빌드에 없어 RenderTexture.fill()+erase()로 "구멍 뚫린 암전"을 구현한다
// (표준 Phaser fog-of-war 기법).

function ensureFogHoleTexture(scene: ArenaScene) {
  if (scene.textures.exists(FOG_HOLE_TEX)) return;
  const g = scene.add.graphics();
  g.fillStyle(0xffffff, 1);
  g.fillCircle(FOG_RADIUS, FOG_RADIUS, FOG_RADIUS);
  g.generateTexture(FOG_HOLE_TEX, FOG_RADIUS * 2, FOG_RADIUS * 2);
  g.destroy();
}

function setupFog(scene: ArenaScene) {
  ensureFogHoleTexture(scene);
  const w = scene.scale.width;
  const h = scene.scale.height;
  const rt = scene.add.renderTexture(0, 0, w, h).setOrigin(0, 0).setDepth(FOG_DEPTH);
  rt.fill(0x000000, FOG_ALPHA);
  rt.erase(FOG_HOLE_TEX, scene.player.x - FOG_RADIUS, scene.player.y - FOG_RADIUS);
  state!.fogRT = rt;
  state!.disposables.push(rt);
}

function tickFog(scene: ArenaScene) {
  if (!state?.fogRT) return;
  const rt = state.fogRT;
  rt.clear();
  rt.fill(0x000000, FOG_ALPHA);
  rt.erase(FOG_HOLE_TEX, scene.player.x - FOG_RADIUS, scene.player.y - FOG_RADIUS);
}

// ── SPEED_SURGE ───────────────────────────────────────────────────────────

function tickSpeedSurge(scene: ArenaScene) {
  const enemies = scene.enemies.getChildren() as Enemy[];
  for (const e of enemies) {
    if (!e.active) continue;
    // chaser/splitter는 moveToObject, shooter는 velocityFromRotation으로 매 프레임 velocity를 절대값 재설정하므로
    // 그 뒤에 곱해도 누적(복리) 없이 매 프레임 +25%로 유지된다.
    e.body.velocity.x *= SPEED_SURGE_MULT;
    e.body.velocity.y *= SPEED_SURGE_MULT;
  }
}

// ── 공통: 위험지대 체류 피해 (LAVA_LEFT/RIGHT, SHRINK_ARENA 공유) ──────────

function tickZoneDamage(scene: ArenaScene, dt: number, inZone: boolean) {
  if (!state) return;
  if (!inZone) {
    state.acc = 0; // 재량 결정: 존을 벗어나면 누적치 리셋(부분 체류 피해가 다음 재진입까지 이월되지 않음)
    return;
  }
  state.acc += LAVA_DPS_PER_SEC * dt;
  while (state.acc >= 1) {
    state.acc -= 1;
    scene.applyDamageToPlayer();
  }
}

function tickShrink(scene: ArenaScene, dt: number) {
  if (!state?.shrinkInner) return;
  tickZoneDamage(scene, dt, !state.shrinkInner.contains(scene.player.x, scene.player.y));
}
