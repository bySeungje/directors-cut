import { EnemyType, Mutation, WaveLog } from '../contracts/directive';

const WALL_MARGIN = 80;
const HOT_COLS = 8;
const HOT_ROWS = 6;

export class WaveTelemetry {
  private quad = { NW: 0, NE: 0, SW: 0, SE: 0 };
  private wallTime = 0;
  private totalTime = 0;
  private shots = 0;
  private hits = 0;
  private kills: Partial<Record<EnemyType, number>> = {};
  private damage: Partial<Record<EnemyType, number>> = {};
  private dashes = 0;
  private grid: number[] = [];          // HOT_COLS × HOT_ROWS 셀별 체류 시간
  private cluster = 0;                  // 밀집도 샘플 누적(시간 가중)
  private clusterTime = 0;              // 밀집도를 잰 시간(적 2기 이상인 구간만)
  private gw = 0; private gh = 0;       // 마지막으로 본 아레나 크기(getHotspot 좌표 환산용)

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
  recordShot(hit: boolean) { this.shots++; if (hit) this.hits++; }
  recordKill(t: EnemyType) { this.kills[t] = (this.kills[t] ?? 0) + 1; }
  recordDamage(t: EnemyType) { this.damage[t] = (this.damage[t] ?? 0) + 1; }
  recordDash() { this.dashes++; }

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
        hotspotConcentration: this.grid.length ? norm(Math.max(...this.grid)) : 0,
      },
      combat: {
        kills: this.kills,
        accuracy: this.shots ? Math.round((this.hits / this.shots) * 100) / 100 : 0,
        clusterRatio: this.clusterTime > 0 ? Math.round((this.cluster / this.clusterTime) * 100) / 100 : 0,
      },
      upgrades, prevMutations,
    };
  }
}
