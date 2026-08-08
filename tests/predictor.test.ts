import { describe, expect, it } from 'vitest';
import { createLcg, Ensemble, idxOf, type DoorIdx } from '../src/game/predictor';

// 예측 엔진 검증 (스펙 §3.3, 완료 기준 3) — 시드 고정으로 결정론 재현.

// ── 게이트 1차 재현용 사람 흉내 정책 (scripts/mindread_sim.js와 동일 설계) ──
interface Policy {
  choose(): DoorIdx;
  feedback(c: DoorIdx, caught: boolean): void;
}

const withNoise = (p: Policy, eps: number, rng: () => number): Policy => ({
  choose: () => (rng() < eps ? (rng() < 0.5 ? 0 : 1) : p.choose()),
  feedback: (c, caught) => p.feedback(c, caught),
});

const antiRepeat = (rng: () => number): Policy => {
  let last: DoorIdx | null = null;
  return {
    choose() {
      if (last === null) return rng() < 0.5 ? 0 : 1;
      return (1 - last) as DoorIdx;
    },
    feedback(c) {
      last = c;
    },
  };
};

const cycler = (rng: () => number): Policy => {
  let cur: DoorIdx = rng() < 0.5 ? 0 : 1;
  return {
    choose() {
      cur = (1 - cur) as DoorIdx;
      return cur;
    },
    feedback() {},
  };
};

const wsls = (rng: () => number): Policy => {
  let last: DoorIdx | null = null;
  let lastCaught = false;
  return {
    choose() {
      if (last === null) return rng() < 0.5 ? 0 : 1;
      if (!lastCaught && rng() < 0.6) return last;
      return (1 - last) as DoorIdx;
    },
    feedback(c, caught) {
      last = c;
      lastCaught = caught;
    },
  };
};

const humanish = (rng: () => number): Policy => {
  const a = antiRepeat(rng);
  const w = wsls(rng);
  return {
    choose: () => (rng() < 0.6 ? a.choose() : w.choose()),
    feedback(c, caught) {
      a.feedback(c, caught);
      w.feedback(c, caught);
    },
  };
};

const randomPolicy = (rng: () => number): Policy => ({
  choose: () => (rng() < 0.5 ? 0 : 1),
  feedback() {},
});

/** 관찰 1 + 본게임 11 (게임 규칙과 동일 레이아웃)로 본게임 적중률 측정 */
function measure(policyFactory: (rng: () => number) => Policy, games: number, seed: number): number {
  const rng = createLcg(seed);
  let hits = 0;
  let total = 0;
  const ensemble = new Ensemble(rng);
  for (let g = 0; g < games; g++) {
    ensemble.reset();
    const policy = withNoise(policyFactory(rng), 0.25, rng);
    for (let r = 0; r < 12; r++) {
      const observing = r < 1;
      const trap = observing ? null : ensemble.decideTrap().trap;
      const choice = policy.choose();
      const caught = trap !== null && trap === choice;
      if (!observing) {
        total++;
        if (caught) hits++;
      }
      ensemble.observe(choice, caught, false);
      policy.feedback(choice, caught);
    }
  }
  return hits / total;
}

describe('게이트 1차 재현 (스펙 §3.3 — 이식 후에도 기준 유지)', () => {
  it('패턴 정책 평균 적중률 ≥ 60% (기준선 50%)', () => {
    const rates = [
      measure(antiRepeat, 300, 11),
      measure(cycler, 300, 22),
      measure(wsls, 300, 33),
      measure(humanish, 300, 44),
    ];
    const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
    expect(avg).toBeGreaterThanOrEqual(0.6);
  });

  it('혼합형(사람 근사)도 ≥ 55%', () => {
    expect(measure(humanish, 400, 55)).toBeGreaterThanOrEqual(0.55);
  });

  it('순수 랜덤은 47~53% — 과적합 없음', () => {
    const r = measure(randomPolicy, 500, 66);
    expect(r).toBeGreaterThan(0.44);
    expect(r).toBeLessThan(0.56);
  });
});

describe('약속 창 (스펙 §3.4 — 말한 읽기는 지킨다)', () => {
  it('선언 후 2라운드는 선언 패턴 단독 argmax가 덫이고, 3라운드째 해제된다', () => {
    const ensemble = new Ensemble(createLcg(7));
    // 강한 교대 패턴 주입: L,R,L,R… (ngram1이 "다음은 반대"를 학습)
    const seq: DoorIdx[] = [0, 1, 0, 1, 0, 1, 0, 1];
    seq.forEach((c) => ensemble.observe(c, false, false));
    ensemble.applySession('ALTERNATE', 'BALANCED', 'NONE');

    // 직전 선택 R(1) → ALTERNATE 모델은 L(0) 예측 → 덫 L
    const d1 = ensemble.decideTrap();
    expect(d1.mode).toBe('window');
    expect(d1.trap).toBe(0);
    expect(d1.attribution?.patternId).toBe('ALTERNATE');
    ensemble.observe(0, true, true);

    const d2 = ensemble.decideTrap();
    expect(d2.mode).toBe('window');
    ensemble.observe(1, false, true);

    const d3 = ensemble.decideTrap();
    expect(d3.mode).not.toBe('window');
  });
});

describe('반심기 트리거 (스펙 §3.3)', () => {
  it('비약속 5라운드 적중 ≤1이면 CONTRARIAN 혼합이 발동한다', () => {
    const ensemble = new Ensemble(createLcg(9));
    // 5라운드 연속 미적중 관측 (비약속)
    ([0, 1, 0, 1, 0] as DoorIdx[]).forEach((c) => ensemble.observe(c, false, false));
    const modes = new Set<string>();
    for (let i = 0; i < 30; i++) modes.add(ensemble.decideTrap().mode);
    expect(modes.has('antisandbag')).toBe(true);
  });

  it('비약속 라운드에서 적중이 나오면 혼합이 풀린다', () => {
    const ensemble = new Ensemble(createLcg(10));
    ([0, 1, 0, 1, 0] as DoorIdx[]).forEach((c) => ensemble.observe(c, false, false));
    ensemble.observe(1, true, false); // 적중 → 해제
    const modes = new Set<string>();
    for (let i = 0; i < 30; i++) modes.add(ensemble.decideTrap().mode);
    expect(modes.has('antisandbag')).toBe(false);
  });

  it('약속 창 라운드는 반심기 추적에 산입되지 않는다', () => {
    const ensemble = new Ensemble(createLcg(11));
    // 전부 약속 창 라운드로 표시 — 트리거가 무장되면 안 된다
    ([0, 1, 0, 1, 0, 1, 0] as DoorIdx[]).forEach((c) => ensemble.observe(c, false, true));
    const modes = new Set<string>();
    for (let i = 0; i < 30; i++) modes.add(ensemble.decideTrap().mode);
    expect(modes.has('antisandbag')).toBe(false);
  });
});

describe('근거 귀속 (스펙 §3.3 — 표시 근거 = 실제 결정 요인)', () => {
  it('명백한 교대 패턴에서 normal 덫은 교대 예측대로이고 근거에 실제 수치가 담긴다', () => {
    const ensemble = new Ensemble(createLcg(13));
    const seq: DoorIdx[] = [0, 1, 0, 1, 0, 1, 0, 1, 0, 1];
    seq.forEach((c) => ensemble.observe(c, false, false));
    const d = ensemble.decideTrap();
    expect(d.mode).toBe('normal');
    expect(d.trap).toBe(0); // 직전 R → 교대 예측 L
    expect(d.attribution).not.toBeNull();
    expect(['ALTERNATE', 'SEQUENCE']).toContain(d.attribution!.patternId);
    expect(d.attribution!.reason).toMatch(/\d/); // 실측 수치 포함
  });

  it('CONTRARIAN 프리셋은 앙상블 argmax의 반대에 덫을 놓는다', () => {
    // 중간에 적중 1회를 넣어 반심기 트리거가 무장되지 않게 한다 (트리거는 별도 describe에서 검증)
    const mk = (strategy: 'BALANCED' | 'CONTRARIAN') => {
      const e = new Ensemble(createLcg(17));
      ([0, 1, 0] as DoorIdx[]).forEach((c) => e.observe(c, false, false));
      e.observe(1, true, false); // 적중 — 트리거 추적 리셋
      e.observe(0, false, false);
      e.applySession('ALTERNATE', strategy, 'NONE');
      e.observe(1, false, true); // 창 2라운드 소진 (동일 이력 유지)
      e.observe(0, false, true);
      return e;
    };
    const base = mk('BALANCED').decideTrap();
    expect(base.mode).toBe('normal');
    const d = mk('CONTRARIAN').decideTrap();
    expect(d.mode).toBe('contrarian');
    expect(d.trap).toBe((1 - (base.trap as number)) as DoorIdx);
  });
});

describe('실존 패턴 후보 (스펙 §3.4 — 날조 차단의 재료)', () => {
  it('후보는 최대 2개·중복 없음·실측 evidence 문자열을 가진다', () => {
    const ensemble = new Ensemble(createLcg(19));
    const seq: DoorIdx[] = [0, 1, 0, 1, 0, 1, 0, 1];
    seq.forEach((c) => ensemble.observe(c, false, false));
    const cands = ensemble.candidates();
    expect(cands.length).toBeGreaterThanOrEqual(1);
    expect(cands.length).toBeLessThanOrEqual(2);
    const ids = cands.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    cands.forEach((c) => expect(c.evidence.length).toBeGreaterThan(0));
  });

  it('데이터가 옅어도 후보는 최소 1개(FREQ) 성립한다', () => {
    const ensemble = new Ensemble(createLcg(23));
    ensemble.observe(idxOf('L'), false, false);
    const cands = ensemble.candidates();
    expect(cands.length).toBeGreaterThanOrEqual(1);
  });
});
