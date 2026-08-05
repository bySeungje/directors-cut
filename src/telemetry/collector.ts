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
