import type { BaitDoor, Door, PatternCandidate, PatternId, Strategy } from '../contracts/directive';

// ── 예측 엔진: 로컬 앙상블 (스펙 §3.3) ──────────────────────────────────────
// 시뮬 게이트 1차(scripts/mindread_sim.js)와 동일 로직·동일 상수의 TS 이식 +
// 프리셋·약속 창·반심기·근거 귀속(신규 규칙, 스펙 §3.3~3.4).
// 전부 결정론·로컬·즉답 — LLM은 이 모듈을 어휘(전략·선언)로만 지휘한다.

export type DoorIdx = 0 | 1; // 0=L, 1=R
export const doorOf = (i: DoorIdx): Door => (i === 0 ? 'L' : 'R');
export const idxOf = (d: Door): DoorIdx => (d === 'L' ? 0 : 1);
const doorKo = (i: DoorIdx) => (i === 0 ? '왼쪽' : '오른쪽');

/** 시드 주입 가능한 LCG — 테스트·시뮬 재현용 (게임 런타임은 Math.random 기본값) */
export function createLcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// ── 상수 (게이트 1차와 동일 — 바꾸면 tests/predictor.test.ts의 재현 기준이 깨진다) ──
const DECAY = 0.9;
const ETA = 4;
const INIT_SCORES = [0, 0.3, 0, 0, 0.3]; // 프라이어 보유 예측기(ngram1·wsls) 초기 신뢰
const N = 2;

// 반심기 트리거 (스펙 §3.3): 최근 5개 비약속 라운드 적중 ≤1 → 성적 급감쇠 + CONTRARIAN 50% 혼합
const SANDBAG_LOOKBACK = 5;
const SANDBAG_MAX_HITS = 1;
const SANDBAG_SCORE_DECAY = 0.5;
const SANDBAG_CONTRA_RATE = 0.5;

const WINDOW_ROUNDS = 2; // 약속 창 길이 (스펙 §3.4)
const BAIT_RATE = 0.7; // BAIT: 지목 문 반대편 가중 (스펙 §3.4 프리셋 표)

const uniform = () => Array(N).fill(1 / N) as number[];
const norm = (a: number[]) => {
  const t = a.reduce((x, y) => x + y, 0);
  return a.map((x) => x / t);
};

interface Observation {
  choice: DoorIdx;
  caught: boolean;
}

interface Predictor {
  reset(): void;
  observe(o: Observation): void;
  predict(): number[];
  /** 실제 관측 수치만으로 만든 근거 (프라이어 불포함 — 날조 금지 불변식의 재료). 데이터 부족 시 null */
  evidence(): string | null;
}

// freq — 위치 편향 (프라이어: 균등 1)
function makeFreq(): Predictor {
  let counts: number[] = [];
  let real: number[] = [];
  return {
    reset() {
      counts = [1, 1];
      real = [0, 0];
    },
    observe(o) {
      counts[o.choice]++;
      real[o.choice]++;
    },
    predict: () => norm([...counts]),
    evidence() {
      const n = real[0] + real[1];
      if (n < 3) return null;
      const top = real[0] >= real[1] ? 0 : 1;
      if (real[top] / n < 0.65) return null;
      return `${n}번 중 ${real[top]}번 ${doorKo(top as DoorIdx)}만 골랐다`;
    },
  };
}

// ngram1 — 직전 선택 → 다음 (프라이어: 반복 회피 — 직전 문 0.7, 반대 1.5)
function makeNgram1(): Predictor {
  let last: DoorIdx | null = null;
  let table: Map<DoorIdx, number[]> = new Map();
  let realStay = 0;
  let realSwitch = 0;
  const fresh = (prev: DoorIdx) => {
    const row = [1.5, 1.5];
    row[prev] = 0.7;
    return row;
  };
  return {
    reset() {
      last = null;
      table = new Map();
      realStay = 0;
      realSwitch = 0;
    },
    observe(o) {
      if (last !== null) {
        if (!table.has(last)) table.set(last, fresh(last));
        table.get(last)![o.choice]++;
        if (o.choice === last) realStay++;
        else realSwitch++;
      }
      last = o.choice;
    },
    predict() {
      if (last === null) return uniform();
      return norm([...(table.get(last) ?? fresh(last))]);
    },
    evidence() {
      const n = realStay + realSwitch;
      if (n < 3) return null;
      if (realSwitch / n >= 0.7) return `같은 문을 두 번 안 가는 버릇 — ${n}번 중 ${realSwitch}번`;
      if (realStay / n >= 0.7) return `한 번 고른 문에 눌러앉는 버릇 — ${n}번 중 ${realStay}번`;
      return null;
    },
  };
}

// ngramK — 짧은 시퀀스 습관 (프라이어 없음)
function makeNgramK(k: number): Predictor & { dominant(): { seq: DoorIdx[]; next: DoorIdx; count: number; total: number } | null } {
  let hist: DoorIdx[] = [];
  let table: Map<string, number[]> = new Map();
  return {
    reset() {
      hist = [];
      table = new Map();
    },
    observe(o) {
      if (hist.length >= k) {
        const key = hist.slice(-k).join(',');
        if (!table.has(key)) table.set(key, [0, 0]);
        table.get(key)![o.choice]++;
      }
      hist.push(o.choice);
    },
    predict() {
      if (hist.length < k) return uniform();
      const counts = table.get(hist.slice(-k).join(','));
      if (!counts) return uniform();
      const t = counts[0] + counts[1];
      return t === 0 ? uniform() : norm([...counts]);
    },
    dominant() {
      let best: { seq: DoorIdx[]; next: DoorIdx; count: number; total: number } | null = null;
      for (const [key, counts] of table) {
        const total = counts[0] + counts[1];
        const next = counts[0] >= counts[1] ? 0 : 1;
        if (total >= 2 && counts[next as number] >= 2 && (!best || counts[next as number] > best.count)) {
          best = { seq: key.split(',').map(Number) as DoorIdx[], next: next as DoorIdx, count: counts[next as number], total };
        }
      }
      return best;
    },
    evidence() {
      const d = this.dominant();
      if (!d) return null;
      const seqKo = d.seq.map((x) => doorKo(x)[0]).join('·');
      return `${seqKo} 다음은 ${d.count}/${d.total}번 ${doorKo(d.next)}이었다`;
    },
  };
}

// wsls — 잡힘/통과 직후 반응 (프라이어: 잡힌 문 회피 강 / 통과 문 유지 약)
function makeWsls(): Predictor {
  let last: Observation | null = null;
  let table: Map<string, number[]> = new Map();
  const real = { caughtStay: 0, caughtShift: 0, passStay: 0, passShift: 0 };
  const fresh = (c: DoorIdx, caught: boolean) => {
    if (caught) {
      const row = [2, 2];
      row[c] = 0.3;
      return row;
    }
    const row = [1, 1];
    row[c] = 1.2;
    return row;
  };
  return {
    reset() {
      last = null;
      table = new Map();
      real.caughtStay = real.caughtShift = real.passStay = real.passShift = 0;
    },
    observe(o) {
      if (last) {
        const key = `${last.choice},${last.caught ? 1 : 0}`;
        if (!table.has(key)) table.set(key, fresh(last.choice, last.caught));
        table.get(key)![o.choice]++;
        if (last.caught) {
          if (o.choice === last.choice) real.caughtStay++;
          else real.caughtShift++;
        } else if (o.choice === last.choice) real.passStay++;
        else real.passShift++;
      }
      last = { ...o };
    },
    predict() {
      if (!last) return uniform();
      const key = `${last.choice},${last.caught ? 1 : 0}`;
      return norm([...(table.get(key) ?? fresh(last.choice, last.caught))]);
    },
    evidence() {
      const nc = real.caughtStay + real.caughtShift;
      if (nc >= 2 && real.caughtShift / nc >= 0.7) return `잡힌 뒤엔 ${nc}번 중 ${real.caughtShift}번 반대로 도망쳤다`;
      const np = real.passStay + real.passShift;
      if (np >= 3 && real.passStay / np >= 0.7) return `재미 본 문을 ${np}번 중 ${real.passStay}번 다시 골랐다`;
      return null;
    },
  };
}

// ── 앙상블 ────────────────────────────────────────────────────────────────
const PREDICTOR_PATTERN: (PatternId | null)[] = ['FREQ', 'ALTERNATE', 'SEQUENCE', 'SEQUENCE', 'AFTER_CAUGHT'];

/** 프리셋 → 예측기 가중 배수 [freq, ngram1, ngram2, ngram3, wsls] (스펙 §3.4 — 수치는 엔진 소유) */
const PRESET_MULT: Record<Strategy, number[]> = {
  BALANCED: [1, 1, 1, 1, 1],
  PRIOR_HEAVY: [1, 2, 1, 1, 2],
  RECENT_ONLY: [1, 1, 1, 1, 1], // 가중은 기본, 성적 감쇠를 0.7로 (observe 시 적용)
  PATTERN_HEAVY: [1, 1, 2, 2, 1],
  CONTRARIAN: [1, 1, 1, 1, 1], // 집행은 decideTrap에서 반전
  BAIT: [1, 1, 1, 1, 1],
};
const RECENT_ONLY_DECAY = 0.7;

export type TrapMode = 'normal' | 'window' | 'contrarian' | 'bait' | 'antisandbag';

export interface Attribution {
  patternId: PatternId;
  /** 화면에 그대로 표시되는 근거 — 실제 덫 결정 요인에서 생성 (불변식: 유닛 테스트 대상) */
  reason: string;
}

export interface TrapDecision {
  trap: DoorIdx | null;
  mode: TrapMode;
  attribution: Attribution | null;
  confidence: number;
}

export class Ensemble {
  private preds = [makeFreq(), makeNgram1(), makeNgramK(2), makeNgramK(3), makeWsls()];
  private scores: number[] = [...INIT_SCORES];
  private rng: () => number;

  private strategy: Strategy = 'BALANCED';
  private baitDoor: BaitDoor = 'NONE';
  private baitArmed = false;

  private windowPattern: PatternId | null = null;
  private windowLeft = 0;

  private sandbagWindow: boolean[] = [];
  private contraMix = false;

  constructor(rng: () => number = Math.random) {
    this.rng = rng;
    this.preds.forEach((p) => p.reset());
  }

  reset(): void {
    this.preds.forEach((p) => p.reset());
    this.scores = [...INIT_SCORES];
    this.strategy = 'BALANCED';
    this.baitDoor = 'NONE';
    this.baitArmed = false;
    this.windowPattern = null;
    this.windowLeft = 0;
    this.sandbagWindow = [];
    this.contraMix = false;
  }

  /** 읽기 세션 적용: 전략 프리셋 교체 + 패턴 선언(약속 창 개시) */
  applySession(patternId: PatternId, strategy: Strategy, baitDoor: BaitDoor): void {
    this.strategy = strategy;
    this.baitDoor = strategy === 'BAIT' ? baitDoor : 'NONE';
    this.baitArmed = this.strategy === 'BAIT' && this.baitDoor !== 'NONE';
    this.windowPattern = patternId;
    this.windowLeft = WINDOW_ROUNDS;
  }

  windowActive(): boolean {
    return this.windowLeft > 0 && this.windowPattern !== null;
  }

  /** 선언 패턴에 대응하는 예측기 인덱스 (SEQUENCE는 성적 높은 쪽) */
  private patternPredIdx(id: PatternId): number {
    if (id === 'FREQ') return 0;
    if (id === 'ALTERNATE') return 1;
    if (id === 'AFTER_CAUGHT') return 4;
    return this.scores[2] >= this.scores[3] ? 2 : 3;
  }

  private mixed(): { mix: number[]; weights: number[] } {
    const mult = PRESET_MULT[this.strategy];
    const ws = this.scores.map((s, i) => Math.exp(ETA * s) * mult[i]);
    const tw = ws.reduce((a, b) => a + b, 0);
    const mix = [0, 0];
    this.preds.forEach((p, i) => {
      const d = p.predict();
      mix[0] += (ws[i] / tw) * d[0];
      mix[1] += (ws[i] / tw) * d[1];
    });
    return { mix, weights: ws.map((w) => w / tw) };
  }

  private argmax(dist: number[]): DoorIdx {
    if (Math.abs(dist[0] - dist[1]) < 1e-12) return this.rng() < 0.5 ? 0 : 1;
    return dist[0] > dist[1] ? 0 : 1;
  }

  /** 덫 결정 — 관찰 라운드는 heist가 이 함수를 부르지 않는다 */
  decideTrap(): TrapDecision {
    // 1) 약속 창: 선언한 패턴이 곧 덫 정책 (스펙 §3.4 "말한 읽기는 지킨다")
    if (this.windowActive()) {
      const pi = this.patternPredIdx(this.windowPattern!);
      const dist = this.preds[pi].predict();
      const trap = this.argmax(dist);
      const ev = this.preds[pi].evidence();
      return {
        trap,
        mode: 'window',
        attribution: { patternId: this.windowPattern!, reason: ev ? `선언한 대로다 — ${ev}` : '선언한 대로 걸었다' },
        confidence: Math.max(...dist),
      };
    }

    const { mix, weights } = this.mixed();
    const conf = Math.max(...mix);
    const base = this.argmax(mix);

    // 2) BAIT: 창 종료 직후 1라운드 — 지목한 문 반대편에 가중 (도발이 덫이 된다)
    if (this.baitArmed) {
      this.baitArmed = false;
      const named: DoorIdx = this.baitDoor === 'L' ? 0 : 1;
      const trap = this.rng() < BAIT_RATE ? ((1 - named) as DoorIdx) : base;
      return {
        trap,
        mode: 'bait',
        attribution: { patternId: 'AFTER_CAUGHT', reason: `${doorKo(named)}이라 말해줬지 — 도망칠 줄 알았다` },
        confidence: conf,
      };
    }

    // 3) 반심기 혼합: 일부러 잡혀주는 패턴 심기 대응 (스펙 §3.3)
    if (this.contraMix && this.rng() < SANDBAG_CONTRA_RATE) {
      return {
        trap: (1 - base) as DoorIdx,
        mode: 'antisandbag',
        attribution: { patternId: this.dominantPattern(weights, mix, base), reason: '일부러 잡혀주는 수작까지 읽었다' },
        confidence: conf,
      };
    }

    // 4) CONTRARIAN 프리셋: 앙상블 argmax의 반대 — 역이용 플레이어 대응
    if (this.strategy === 'CONTRARIAN') {
      return {
        trap: (1 - base) as DoorIdx,
        mode: 'contrarian',
        attribution: { patternId: this.dominantPattern(weights, mix, base), reason: '네가 내 수를 읽는 것까지 계산했다' },
        confidence: conf,
      };
    }

    // 5) 기본: 성적 가중 앙상블 argmax + 최대 기여 예측기 귀속
    const domId = this.dominantPattern(weights, mix, base);
    const domIdx = this.dominantPredIdx(weights, base);
    const ev = this.preds[domIdx].evidence();
    return {
      trap: base,
      mode: 'normal',
      attribution: { patternId: domId, reason: ev ?? '아직 네 버릇을 재는 중이다' },
      confidence: conf,
    };
  }

  /** 최대 기여 예측기 = argmax_i (가중_i × dist_i[trap]) — 근거 귀속 불변식의 정의 (스펙 §3.3) */
  private dominantPredIdx(weights: number[], trap: DoorIdx): number {
    let best = 0;
    let bestV = -1;
    this.preds.forEach((p, i) => {
      const v = weights[i] * p.predict()[trap];
      if (v > bestV) {
        bestV = v;
        best = i;
      }
    });
    return best;
  }

  private dominantPattern(weights: number[], _mix: number[], trap: DoorIdx): PatternId {
    return PREDICTOR_PATTERN[this.dominantPredIdx(weights, trap)] ?? 'FREQ';
  }

  /** 라운드 결과 반영. windowRound = 약속 창 라운드 (반심기 추적 제외 — 창의 확정 통과는 의도된 것) */
  observe(choice: DoorIdx, caught: boolean, windowRound: boolean): void {
    const decay = this.strategy === 'RECENT_ONLY' ? RECENT_ONLY_DECAY : DECAY;
    this.preds.forEach((p, i) => {
      const d = p.predict();
      const hit = this.argmax(d) === choice ? 1 : 0;
      this.scores[i] = this.scores[i] * decay + hit * (1 - decay);
    });
    this.preds.forEach((p) => p.observe({ choice, caught }));

    if (this.windowLeft > 0) this.windowLeft--;

    if (!windowRound) {
      this.sandbagWindow.push(caught);
      if (this.sandbagWindow.length > SANDBAG_LOOKBACK) this.sandbagWindow.shift();
      if (caught) {
        this.contraMix = false;
        this.sandbagWindow = [];
      } else if (
        !this.contraMix &&
        this.sandbagWindow.length === SANDBAG_LOOKBACK &&
        this.sandbagWindow.filter(Boolean).length <= SANDBAG_MAX_HITS
      ) {
        this.contraMix = true;
        this.scores = this.scores.map((s) => s * SANDBAG_SCORE_DECAY);
      }
    }
  }

  /** 읽기 세션용 실존 패턴 후보 (상위 2) — LLM은 이 중에서만 선언한다 (날조 구조 차단) */
  candidates(): PatternCandidate[] {
    const items: PatternCandidate[] = [];
    const seen = new Set<PatternId>();
    const order = this.preds
      .map((p, i) => ({ i, score: this.scores[i] }))
      .sort((a, b) => b.score - a.score);
    for (const { i, score } of order) {
      const id = PREDICTOR_PATTERN[i];
      if (!id || seen.has(id)) continue;
      const ev = this.preds[i].evidence();
      if (!ev) continue;
      seen.add(id);
      items.push({ id, evidence: ev, score: Math.round(score * 100) / 100 });
      if (items.length === 2) break;
    }
    if (items.length === 0) {
      // 데이터가 옅어도 세션은 성립해야 한다 — freq는 관찰 1라운드부터 실통계가 있다
      const real = this.preds[0].evidence();
      items.push({ id: 'FREQ', evidence: real ?? '아직 뚜렷한 버릇 없음 — 관찰 계속', score: Math.round(this.scores[0] * 100) / 100 });
    }
    return items;
  }

  /** 앙상블 예측기별 성적 (프롬프트·디렉터 로그용) */
  stats(): { id: string; score: number }[] {
    const names = ['freq', 'ngram1', 'ngram2', 'ngram3', 'wsls'];
    return names.map((id, i) => ({ id, score: Math.round(this.scores[i] * 1000) / 1000 }));
  }
}
