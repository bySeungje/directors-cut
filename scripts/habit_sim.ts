/**
 * 습관 지표 분포 시뮬레이터 — 임계값을 정하기 위한 계측 도구.
 *
 * **왜 repo에 두나**: 2026-08-08 독립 검토가 같은 시뮬레이션을 돌려 지표 결함 4건을 찾았는데,
 * 스크립트가 세션 스크래치패드에 있어 휘발됐다(`docs/_hub/nodes/S-review-sim-20260808.md`의 한계 항목).
 * 임계값은 재조정될 것이므로 재현 가능해야 한다.
 *
 * 실행: `npx vite-node scripts/habit_sim.ts`
 *
 * 실제 `WaveTelemetry`를 그대로 쓴다 — 재구현하면 그 재구현이 틀릴 수 있다.
 */
import { WaveTelemetry, HABIT_WINDOW_SEC } from '../src/telemetry/collector';
import { HABITS, detectHabit, type HabitReading } from '../src/game/habits';
import type { HabitId } from '../src/contracts/directive';

const W = 960, H = 640;
const DT = 1 / 60;
const SPEED = 220;            // BASE_STATS.moveSpeed
const DASH_CD_MS = 2000;      // BASE_STATS.dashCooldownMs — 가동률의 분모

type Path = (t: number) => { x: number; y: number };

/** 궤적 — 이름과 위치 함수. 대시는 별도 비율로 준다. */
const PATHS: { name: string; path: Path; dashPerSec: number }[] = [
  {
    name: '원 궤도 키팅 r=200',
    path: (t) => { const a = (SPEED / 200) * t; return { x: W / 2 + Math.cos(a) * 200, y: H / 2 + Math.sin(a) * 200 }; },
    dashPerSec: 0.1,
  },
  {
    name: '외곽 순찰 (40px 안쪽)',
    path: (t) => {
      const per = 2 * ((W - 80) + (H - 80)); const d = (SPEED * t) % per;
      const w = W - 80, h = H - 80;
      if (d < w) return { x: 40 + d, y: 40 };
      if (d < w + h) return { x: W - 40, y: 40 + (d - w) };
      if (d < 2 * w + h) return { x: W - 40 - (d - w - h), y: H - 40 };
      return { x: 40, y: H - 40 - (d - 2 * w - h) };
    },
    dashPerSec: 0.1,
  },
  {
    name: '구석 캠핑 ±60px',
    path: (t) => ({ x: 140 + Math.cos(t * 2) * 60, y: 500 + Math.sin(t * 2) * 60 }),
    dashPerSec: 0.05,
  },
  {
    name: '정지 (중앙)',
    path: () => ({ x: W / 2, y: H / 2 }),
    dashPerSec: 0,
  },
  {
    name: '우측 절반만 (용암 회피)',
    path: (t) => { const a = (SPEED / 160) * t; return { x: W * 0.72 + Math.cos(a) * 160, y: H / 2 + Math.sin(a) * 160 }; },
    dashPerSec: 0.15,
  },
  {
    name: '전면 무작위 이동',
    path: (t) => ({ x: W / 2 + Math.cos(t * 0.7) * 380, y: H / 2 + Math.sin(t * 1.3) * 250 }),
    dashPerSec: 0.3,
  },
  {
    name: '대시 남용 (전면 이동)',
    path: (t) => ({ x: W / 2 + Math.cos(t * 0.9) * 350, y: H / 2 + Math.sin(t * 1.1) * 230 }),
    dashPerSec: 0.5,
  },
];

/** 창 기준 지표를 뽑는다. 판정은 웨이브 종료 시점의 창(마지막 HABIT_WINDOW_SEC초)을 본다. */
function run(path: Path, durSec: number, dashPerSec: number): HabitReading {
  const t = new WaveTelemetry();
  const dashes = Math.round(durSec * dashPerSec);
  for (let i = 0; i < Math.round(durSec / DT); i++) {
    const s = i * DT;
    const p = path(s);
    t.tick(p.x, p.y, W, H, DT, []);
  }
  for (let i = 0; i < dashes; i++) t.recordDash();
  const peek = t.peek();
  const maxRate = 1000 / DASH_CD_MS;
  return { corner: peek.corner, anchor: peek.anchor, dashUptime: Math.min(1, dashes / durSec / maxRate) };
}

const DURATIONS = [12, 25, 45];
const pad = (s: string, n: number) => s.padEnd(n, ' ');
const num = (v: number) => v.toFixed(2).padStart(5, ' ');

console.log(`창 = 마지막 ${HABIT_WINDOW_SEC}초 · 임계: ANCHOR ${HABITS.ANCHOR.threshold} / CORNER ${HABITS.CORNER.threshold} / DASH ${HABITS.DASH.threshold}\n`);
console.log(`${pad('궤적', 26)}${pad('길이', 6)}${pad('anchor', 8)}${pad('corner', 8)}${pad('dash가동', 8)}선택`);
console.log('─'.repeat(70));

for (const { name, path, dashPerSec } of PATHS) {
  for (const dur of DURATIONS) {
    const r = run(path, dur, dashPerSec);
    const picked = detectHabit(r);
    const mark = (id: HabitId) => (HABITS[id].read(r) >= HABITS[id].threshold ? '*' : ' ');
    console.log(
      pad(name, 26) + pad(`${dur}s`, 6) +
      pad(num(r.anchor) + mark('ANCHOR'), 8) +
      pad(num(r.corner) + mark('CORNER'), 8) +
      pad(num(r.dashUptime) + mark('DASH'), 8) +
      (picked ?? '—'),
    );
  }
}

console.log('\n* = 임계 초과. "—" = 예측 없음(읽을 습관이 없다).');
console.log('길이를 바꿔도 값이 안정적이어야 한다 — 창이 웨이브 길이 의존성을 제거했는지 확인하는 것이 이 표의 목적이다.');
