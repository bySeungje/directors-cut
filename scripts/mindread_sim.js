// 수읽기 시뮬 게이트 v2 — 수정 1회: 인간 편향 프라이어 + 관찰 라운드 2회
// 판정 기준(사전 선언, v1과 동일 강도): 본게임 10라운드 기준
//   3문: 패턴 정책 평균 45%+ · humanish 38%+ · random 30~36%
//   2문: 패턴 정책 평균 62%+ · humanish 55%+ · random 47~53%

function uniform(N) { return Array(N).fill(1 / N); }
function norm(a) { const t = a.reduce((x, y) => x + y, 0); return a.map(x => x / t); }

// ---------- 예측기 (프라이어 = 가상 카운트) ----------

function makeFreq(N) {
  let counts;
  return {
    name: 'freq',
    // 약한 중앙 선호 프라이어 (3문 이상일 때 가운데 1.2)
    reset() {
      counts = Array(N).fill(1);
      if (N % 2 === 1) counts[(N - 1) / 2] = 1.2;
    },
    observe(c) { counts[c]++; },
    predict() { return norm([...counts]); },
  };
}

function makeNgram1(N) {
  let last, table;
  const fresh = prev => {
    // 반복 회피 약 프라이어: 직전 문 0.7, 나머지 1.5
    const row = Array(N).fill(1.5);
    row[prev] = 0.7;
    return row;
  };
  return {
    name: 'ngram1',
    reset() { last = null; table = new Map(); },
    observe(c) {
      if (last !== null) {
        if (!table.has(last)) table.set(last, fresh(last));
        table.get(last)[c]++;
      }
      last = c;
    },
    predict() {
      if (last === null) return uniform(N);
      return norm([...(table.get(last) ?? fresh(last))]);
    },
  };
}

function makeNgramK(N, k) {
  let hist, table;
  return {
    name: `ngram${k}`,
    reset() { hist = []; table = new Map(); },
    observe(c) {
      if (hist.length >= k) {
        const key = hist.slice(-k).join(',');
        if (!table.has(key)) table.set(key, Array(N).fill(0));
        table.get(key)[c]++;
      }
      hist.push(c);
    },
    predict() {
      if (hist.length < k) return uniform(N);
      const counts = table.get(hist.slice(-k).join(','));
      if (!counts) return uniform(N);
      const t = counts.reduce((a, b) => a + b, 0);
      return t === 0 ? uniform(N) : counts.map(x => x / t);
    },
  };
}

function makeWSLS(N) {
  let last, table;
  const fresh = (c, caught) => {
    if (caught) {
      // lose-shift 강 프라이어: 잡힌 문 회피
      const row = Array(N).fill(2);
      row[c] = 0.3;
      return row;
    }
    // win-stay 약 프라이어
    const row = Array(N).fill(1);
    row[c] = 1.2;
    return row;
  };
  return {
    name: 'wsls',
    reset() { last = null; table = new Map(); },
    observe(c, caught) {
      if (last) {
        const key = `${last.c},${last.caught ? 1 : 0}`;
        if (!table.has(key)) table.set(key, fresh(last.c, last.caught));
        table.get(key)[c]++;
      }
      last = { c, caught };
    },
    predict() {
      if (!last) return uniform(N);
      const key = `${last.c},${last.caught ? 1 : 0}`;
      return norm([...(table.get(key) ?? fresh(last.c, last.caught))]);
    },
  };
}

function makeEnsemble(N) {
  const preds = [makeFreq(N), makeNgram1(N), makeNgramK(N, 2), makeNgramK(N, 3), makeWSLS(N)];
  const INIT = [0, 0.3, 0, 0, 0.3]; // 프라이어 보유 예측기 초기 신뢰
  let scores;
  const DECAY = 0.9, ETA = 4;
  return {
    reset() { preds.forEach(p => p.reset()); scores = [...INIT]; },
    update(choice, caught) {
      preds.forEach((p, i) => {
        const d = p.predict();
        const hit = d.indexOf(Math.max(...d)) === choice ? 1 : 0;
        scores[i] = scores[i] * DECAY + hit * (1 - DECAY);
      });
      preds.forEach(p => p.observe(choice, caught));
    },
    predict() {
      const ws = scores.map(s => Math.exp(ETA * s));
      const tw = ws.reduce((a, b) => a + b, 0);
      const mix = Array(N).fill(0);
      preds.forEach((p, i) => {
        const d = p.predict();
        for (let j = 0; j < N; j++) mix[j] += (ws[i] / tw) * d[j];
      });
      return mix;
    },
  };
}

function argmaxRandomTie(dist) {
  const m = Math.max(...dist);
  const idxs = dist.map((v, i) => [v, i]).filter(([v]) => v > m - 1e-12).map(([, i]) => i);
  return idxs[Math.floor(Math.random() * idxs.length)];
}

// ---------- 사람 흉내 정책 (v1 + feedback 일관성 수정: 노이즈 선택도 자기 이력) ----------

function withNoise(policy, eps, N) {
  return {
    name: `${policy.name}+ε${eps}`,
    reset: () => policy.reset(),
    choose() {
      if (Math.random() < eps) return Math.floor(Math.random() * N);
      return policy.choose();
    },
    feedback: (c, caught, trap) => policy.feedback(c, caught, trap),
  };
}

function pRandom(N) {
  return { name: 'random', reset() {}, choose: () => Math.floor(Math.random() * N), feedback() {} };
}

function pAntiRepeat(N) {
  let last = null;
  return {
    name: 'antiRepeat',
    reset() { last = null; },
    choose() {
      let c;
      do { c = Math.floor(Math.random() * N); } while (N > 1 && c === last);
      return c;
    },
    feedback(c) { last = c; },
  };
}

function pCycler(N) {
  let cur = null;
  return {
    name: 'cycler',
    reset() { cur = Math.floor(Math.random() * N); },
    choose() { cur = (cur + 1) % N; return cur; },
    feedback() {},
  };
}

function pWSLS(N) {
  let last = null, lastCaught = false;
  return {
    name: 'wsls',
    reset() { last = null; lastCaught = false; },
    choose() {
      if (last === null) return Math.floor(Math.random() * N);
      if (!lastCaught && Math.random() < 0.6) return last;
      let c;
      do { c = Math.floor(Math.random() * N); } while (N > 1 && c === last);
      return c;
    },
    feedback(c, caught) { last = c; lastCaught = caught; },
  };
}

function pDoubleBluff(N) {
  let lastTrapHit = null;
  return {
    name: 'doubleBluff',
    reset() { lastTrapHit = null; },
    choose() {
      if (lastTrapHit !== null && Math.random() < 0.55) return lastTrapHit;
      return Math.floor(Math.random() * N);
    },
    feedback(c, caught) { lastTrapHit = caught ? c : null; },
  };
}

function pHumanish(N) {
  const a = pAntiRepeat(N), w = pWSLS(N);
  return {
    name: 'humanish',
    reset() { a.reset(); w.reset(); },
    choose() { return Math.random() < 0.6 ? a.choose() : w.choose(); },
    feedback(c, caught, trap) { a.feedback(c, caught, trap); w.feedback(c, caught, trap); },
  };
}

// ---------- 러너: 관찰 2 + 본게임 10 ----------
const OBS = 2, MAIN = 10, ROUNDS = OBS + MAIN;

function runGame(N, policy, ensemble) {
  policy.reset();
  ensemble.reset();
  const hits = [];
  for (let r = 0; r < ROUNDS; r++) {
    const observing = r < OBS;
    const trap = observing ? null : argmaxRandomTie(ensemble.predict());
    const choice = policy.choose();
    const caught = trap !== null && choice === trap;
    if (!observing) hits.push(caught ? 1 : 0);
    ensemble.update(choice, caught);
    policy.feedback(choice, caught, trap);
  }
  return hits;
}

function simulate(N, games, policyFactory) {
  const perRound = Array(MAIN).fill(0);
  const ensemble = makeEnsemble(N);
  for (let g = 0; g < games; g++) {
    const hits = runGame(N, policyFactory(), ensemble);
    hits.forEach((h, i) => (perRound[i] += h));
  }
  const rates = perRound.map(x => x / games);
  const overall = rates.reduce((a, b) => a + b, 0) / MAIN;
  return { overall, rates };
}

const GAMES = 2000, EPS = 0.25;
for (const N of [2, 3]) {
  const policies = [
    () => pRandom(N),
    () => withNoise(pAntiRepeat(N), EPS, N),
    () => withNoise(pCycler(N), EPS, N),
    () => withNoise(pWSLS(N), EPS, N),
    () => withNoise(pDoubleBluff(N), EPS, N),
    () => withNoise(pHumanish(N), EPS, N),
  ];
  console.log(`\n=== 문 ${N}개 (기준선 ${(100 / N).toFixed(1)}%) · 관찰 ${OBS} + 본게임 ${MAIN}라운드 × ${GAMES}게임 ===`);
  console.log('정책              | 본게임  | 라운드별(관찰 제외)');
  const patternRates = [];
  for (const pf of policies) {
    const name = pf().name.padEnd(17);
    const r = simulate(N, GAMES, pf);
    if (!pf().name.startsWith('random')) patternRates.push(r.overall);
    const curve = r.rates.map(x => (x * 100).toFixed(0).padStart(3)).join(' ');
    console.log(`${name} | ${(r.overall * 100).toFixed(1).padStart(5)}% | ${curve}`);
  }
  const avg = patternRates.reduce((a, b) => a + b, 0) / patternRates.length;
  console.log(`패턴 정책 평균(random 제외): ${(avg * 100).toFixed(1)}%`);
}
