import Phaser from 'phaser';
import type { Composition, Directive, EnemyType } from '../contracts/directive';
import type { ArenaScene } from './scenes/ArenaScene';
import { applyMutation } from './mutations';
import { setActiveBuff } from './buffs';

const SPAWN_MARGIN = 40; // 화면 밖 40px에서 진입
const RING_RADIUS = 320; // RING: 플레이어 중심 반경 320px
const STORM_BATCH_COUNT = 3; // SPAWN_STORM: composition을 3분할
const STORM_INTERVAL_MS = 4000; // 4초 간격 순차 스폰

type Edge = 'N' | 'S' | 'E' | 'W';
const OPPOSITE_EDGE: Record<Edge, Edge> = { N: 'S', S: 'N', E: 'W', W: 'E' };

/** 디렉티브를 실제 스폰+mutation으로 실행한다. SPAWN_STORM이면 4초 간격 3분할 스폰. */
export function runDirective(scene: ArenaScene, d: Directive): void {
  applyMutation(scene, d.mutation);
  setActiveBuff(d.buff, scene.time.now);

  if (d.mutation === 'SPAWN_STORM') {
    // count가 작은 composition(예: count=1,2)은 splitIntoStormBatches가 뒤쪽 배치를 빈 배열로 반환할 수 있다.
    // 빈 배치까지 그대로 스케줄하면 markSpawningComplete가 "마지막 배치 인덱스" 기준으로 최대 8초까지
    // 밀려 wave-clear 판정이 지연된다 — 빈 배치를 제거하고 실제로 스폰이 있는 마지막 배치 시점에 완료 처리한다.
    const batches = splitIntoStormBatches(d.composition).filter((batch) => batch.length > 0);
    if (batches.length === 0) {
      // composition/count 스키마 제약(최소 1)상 실질적으로 도달하지 않지만, 방어적으로 즉시 완료 처리한다.
      scene.markSpawningComplete();
      return;
    }
    batches.forEach((batch, i) => {
      scene.time.delayedCall(i * STORM_INTERVAL_MS, () => {
        if (scene.isPlayerDead()) return;
        spawnComposition(scene, batch);
        if (i === batches.length - 1) scene.markSpawningComplete();
      });
    });
  } else {
    spawnComposition(scene, d.composition);
    scene.markSpawningComplete();
  }
}

// ── composition → 스폰 좌표 ─────────────────────────────────────────────

function spawnComposition(scene: ArenaScene, composition: Composition[]) {
  for (const c of composition) {
    switch (c.spawn) {
      case 'N':
      case 'S':
      case 'E':
      case 'W':
        spawnAtEdge(scene, c.spawn, c.type, c.elite, c.count);
        break;
      case 'RING':
        spawnRing(scene, c.type, c.elite, c.count);
        break;
      case 'PINCER':
        spawnPincer(scene, c.type, c.elite, c.count);
        break;
      case 'BEHIND':
        spawnBehind(scene, c.type, c.elite, c.count);
        break;
    }
  }
}

function edgePoint(scene: ArenaScene, edge: Edge): { x: number; y: number } {
  const w = scene.scale.width;
  const h = scene.scale.height;
  switch (edge) {
    case 'N':
      return { x: Phaser.Math.Between(0, w), y: -SPAWN_MARGIN };
    case 'S':
      return { x: Phaser.Math.Between(0, w), y: h + SPAWN_MARGIN };
    case 'E':
      return { x: w + SPAWN_MARGIN, y: Phaser.Math.Between(0, h) };
    case 'W':
      return { x: -SPAWN_MARGIN, y: Phaser.Math.Between(0, h) };
  }
}

function spawnAtEdge(scene: ArenaScene, edge: Edge, type: EnemyType, elite: boolean, count: number) {
  for (let i = 0; i < count; i++) {
    const { x, y } = edgePoint(scene, edge);
    scene.spawnEnemy(type, x, y, elite);
  }
}

/** RING: 플레이어 중심 반경 320px 원주 균등 배치 */
function spawnRing(scene: ArenaScene, type: EnemyType, elite: boolean, count: number) {
  const cx = scene.player.x;
  const cy = scene.player.y;
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count;
    scene.spawnEnemy(type, cx + Math.cos(angle) * RING_RADIUS, cy + Math.sin(angle) * RING_RADIUS, elite);
  }
}

/** 플레이어 이동 방향(정지 중이면 조준 방향으로 대체 — 브리프에 정지 시 규칙 없음, 재량 결정) → 가장 가까운 축(N/S/E/W) */
function movementEdge(scene: ArenaScene): Edge {
  const v = scene.player.body.velocity;
  const speed = Math.hypot(v.x, v.y);
  const angle = speed > 1 ? Math.atan2(v.y, v.x) : scene.player.rotation;
  return angleToEdge(angle);
}

function angleToEdge(angle: number): Edge {
  const twoPi = Math.PI * 2;
  let a = angle % twoPi;
  if (a < 0) a += twoPi;
  const deg = Phaser.Math.RadToDeg(a);
  if (deg >= 315 || deg < 45) return 'E';
  if (deg < 135) return 'S';
  if (deg < 225) return 'W';
  return 'N';
}

/** PINCER: 진행 방향 앞(전방 edge) + 뒤(반대 edge) 2그룹 — count를 절반씩 분할 */
function spawnPincer(scene: ArenaScene, type: EnemyType, elite: boolean, count: number) {
  const front = movementEdge(scene);
  const back = OPPOSITE_EDGE[front];
  const frontCount = Math.ceil(count / 2);
  spawnAtEdge(scene, front, type, elite, frontCount);
  spawnAtEdge(scene, back, type, elite, count - frontCount);
}

/** BEHIND: 이동 반대 방향 edge에서 전량 스폰 */
function spawnBehind(scene: ArenaScene, type: EnemyType, elite: boolean, count: number) {
  const edge = OPPOSITE_EDGE[movementEdge(scene)];
  spawnAtEdge(scene, edge, type, elite, count);
}

// ── SPAWN_STORM: composition 3분할 ──────────────────────────────────────

function splitIntoStormBatches(composition: Composition[]): Composition[][] {
  const batches: Composition[][] = Array.from({ length: STORM_BATCH_COUNT }, () => []);
  for (const c of composition) {
    const parts = splitCount(c.count, STORM_BATCH_COUNT);
    parts.forEach((n, i) => {
      if (n > 0) batches[i].push({ ...c, count: n });
    });
  }
  return batches;
}

/** count를 n등분(나머지는 앞쪽 배치부터 +1). 예: 10 → [4,3,3], 1 → [1,0,0]. */
function splitCount(count: number, n: number): number[] {
  const base = Math.floor(count / n);
  const remainder = count % n;
  return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0));
}
