import { EnemyType, Mutation, WaveLog } from '../contracts/directive';

const WALL_MARGIN = 80;
const HOT_COLS = 8;
const HOT_ROWS = 6;

/** 습관 판정용 롤링 창(초).
 *
 *  왜 웨이브 전체가 아닌가: 전체 비율은 행동이 아니라 **웨이브 길이**를 잰다. 같은 궤적인데 15초
 *  웨이브면 maxQuad 0.89, 30초면 0.45다. 예산 곡선상 다음 웨이브는 항상 더 길어서, 행동을 안 바꿔도
 *  판정이 뒤집힌다. 상세: `docs/_hub/nodes/C-duration-normalized-metrics.md` */
export const HABIT_WINDOW_SEC = 12;

/** 미세 회피 판정의 하한 경로 길이(px). 이보다 덜 움직였으면 "많이 움직이는데 좁다"가 성립하지 않는다. */
const MICRO_MIN_PATH_PX = 900;
/** 미세 회피 기준 회전반경(px). 이보다 좁게 흔들면 1에 가까워진다. 아레나 960×640의 약 1/6. */
const MICRO_REF_RADIUS_PX = 150;

type QuadKey = 'NW' | 'NE' | 'SW' | 'SE';

/** 창 기준 습관 지표. 살아 있는 미터와 웨이브 종료 판정이 **같은 값**을 쓴다. */
export interface HabitSample {
  /** 창 안에서 한 사분면에 머문 비율 (0~1) */
  corner: number;
  /** 창 안에서 최다 체류 셀의 비율 (0~1) */
  anchor: number;
  /** 선회 일관성 (0~1). 중심 기준 누적 회전각의 **순합 / 절대합**.
   *  1에 가까울수록 한 방향으로만 돈다. 방향은 `orbitSign`이 갖는다. */
  orbit: number;
  /** 선회 방향: +1 시계, -1 반시계, 0 미판정. */
  orbitSign: number;
  /** 미세 회피 (0~1). 이동 경로는 긴데 회전반경이 작을수록 높다 —
   *  "제자리에서 흔들어 탄만 피하는" 플레이. anchor(가만히 있음)와 다르다: 이쪽은 많이 움직인다. */
  micro: number;
}

export class WaveTelemetry {
  private quad = { NW: 0, NE: 0, SW: 0, SE: 0 };
  private wallTime = 0;
  private totalTime = 0;
  private shots = 0;
  private hits = 0;
  private manualAttacks = 0;
  private visionExposureSec = 0;
  private exitReached = false;
  private kills: Partial<Record<EnemyType, number>> = {};
  private damage: Partial<Record<EnemyType, number>> = {};
  private dashes = 0;
  private grid: number[] = [];          // HOT_COLS × HOT_ROWS 셀별 체류 시간
  private cluster = 0;                  // 밀집도 샘플 누적(시간 가중)
  private clusterTime = 0;              // 밀집도를 잰 시간(적 2기 이상인 구간만)
  private gw = 0; private gh = 0;       // 마지막으로 본 아레나 크기(getHotspot 좌표 환산용)

  // ── 롤링 창 (습관 판정 전용 — 위 누적값은 LLM 프롬프트용이라 건드리지 않는다) ──
  private win: { t: number; quad: QuadKey; cell: number; dt: number; x: number; y: number; dAng: number; path: number }[] = [];
  private winAngNet = 0;   // 부호 있는 회전각 누적 (선회 방향)
  private winAngAbs = 0;   // 회전각 절대값 누적 (선회 총량)
  private winPath = 0;     // 이동 경로 길이
  private prevX = -1; private prevY = -1; private prevAng = 0;
  private winQuad: Record<QuadKey, number> = { NW: 0, NE: 0, SW: 0, SE: 0 };
  private winGrid: number[] = [];
  private winTotal = 0;

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
    const cell = cy * HOT_COLS + cx;
    this.grid[cell] += dt;

    // 롤링 창 — 증분 갱신 후 창 밖 샘플을 앞에서 덜어낸다(프레임당 대개 1개)
    if (this.winGrid.length === 0) this.winGrid = new Array(HOT_COLS * HOT_ROWS).fill(0);
    // 운동학 — 아레나 중심 기준 각도의 부호 있는 변화량과 이동 경로 길이.
    // 각도 차이는 ±π로 감아 큰 점프(경계 통과)를 만들지 않는다.
    const ang = Math.atan2(y - h / 2, x - w / 2);
    let dAng = 0, seg = 0;
    if (this.prevX >= 0) {
      dAng = ang - this.prevAng;
      while (dAng > Math.PI) dAng -= Math.PI * 2;
      while (dAng < -Math.PI) dAng += Math.PI * 2;
      seg = Math.hypot(x - this.prevX, y - this.prevY);
    }
    this.prevX = x; this.prevY = y; this.prevAng = ang;

    this.win.push({ t: this.totalTime, quad: key, cell, dt, x, y, dAng, path: seg });
    this.winQuad[key] += dt;
    this.winGrid[cell] += dt;
    this.winTotal += dt;
    this.winAngNet += dAng;
    this.winAngAbs += Math.abs(dAng);
    this.winPath += seg;
    while (this.win.length > 0 && this.win[0].t < this.totalTime - HABIT_WINDOW_SEC) {
      const s = this.win.shift()!;
      this.winQuad[s.quad] -= s.dt;
      this.winGrid[s.cell] -= s.dt;
      this.winAngNet -= s.dAng;
      this.winAngAbs -= Math.abs(s.dAng);
      this.winPath -= s.path;
      this.winTotal -= s.dt;
    }

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
  recordManualAttack() { this.manualAttacks++; }
  recordVisionExposure(dt: number) { this.visionExposureSec += dt; }
  recordExitReached() { this.exitReached = true; }
  recordKill(t: EnemyType) { this.kills[t] = (this.kills[t] ?? 0) + 1; }
  recordDamage(t: EnemyType) { this.damage[t] = (this.damage[t] ?? 0) + 1; }
  recordDash() { this.dashes++; }

  /** 전투 중 미터가 대시 **비율**을 그리려면 진행 중 카운트가 필요하다(카운트 자체는 판정에 쓰지 않는다). */
  dashCount(): number { return this.dashes; }

  /** 창 기준 현재 습관 지표. 전투 중 미터와 웨이브 종료 판정이 이 하나를 공유한다 —
   *  화면에 보이는 값과 채점되는 값이 다르면 플레이어가 반증할 방법이 없다. */
  peek(): HabitSample {
    const t = Math.max(this.winTotal, 0.001);
    let maxQuad = 0;
    for (const k of ['NW', 'NE', 'SW', 'SE'] as QuadKey[]) if (this.winQuad[k] > maxQuad) maxQuad = this.winQuad[k];
    const maxCell = this.winGrid.length > 0 ? Math.max(...this.winGrid) : 0;

    // 선회 — 순합/절대합. 절대합이 충분히 쌓이기 전에는 판정하지 않는다(0은 낮음이 아니라 데이터 없음:
    // docs/_hub/nodes/C-zero-is-absence.md). 최소 1바퀴(2π)는 돌아야 "돈다"고 말할 수 있다.
    const orbit = this.winAngAbs >= Math.PI * 2 ? Math.abs(this.winAngNet) / this.winAngAbs : 0;
    const orbitSign = orbit > 0 ? Math.sign(this.winAngNet) : 0;

    // 미세 회피 — 경로는 긴데 회전반경이 작다. 회전반경은 창 안 좌표의 표준편차(2D).
    // 경로가 짧으면(거의 정지) 판정하지 않는다 — 그건 anchor가 잡는 습관이지 이쪽이 아니다.
    let micro = 0;
    if (this.winPath >= MICRO_MIN_PATH_PX && this.win.length > 1) {
      let sx = 0, sy = 0;
      for (const s2 of this.win) { sx += s2.x; sy += s2.y; }
      const mx = sx / this.win.length, my = sy / this.win.length;
      let v = 0;
      for (const s2 of this.win) v += (s2.x - mx) ** 2 + (s2.y - my) ** 2;
      const gyration = Math.sqrt(v / this.win.length);
      micro = Math.max(0, 1 - gyration / MICRO_REF_RADIUS_PX);
    }

    return { corner: maxQuad / t, anchor: maxCell / t, orbit, orbitSign, micro };
  }

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
        manualAttacks: this.manualAttacks,
      },
      stealth: {
        visionExposureSec: Math.round(this.visionExposureSec * 10) / 10,
        exitReached: this.exitReached,
      },
      upgrades, prevMutations,
    };
  }
}
