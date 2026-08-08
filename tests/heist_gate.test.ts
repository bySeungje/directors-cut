import { describe, expect, it } from 'vitest';
import type { Door, PatternId } from '../src/contracts/directive';
import { DEFAULT_TARGET, Heist, OBS_ROUNDS } from '../src/game/heist';
import { createLcg, Ensemble } from '../src/game/predictor';

// ── 시뮬 게이트 2차: 판돈 수학 성립 조건 4밴드 (스펙 §3.2 — 사전 선언 기준) ──
// 실게임 규칙 전체(관찰·세션 폴백·약속 창·반심기·조기 종료)로 정책군 승률을 잰다.
// 1밴드: 읽히는 무전략 <15% / 2밴드: 역읽기(창 활용) 45~70% / 3밴드: 랜덤 10~30%
// 4밴드: 심기(sandbag) 최고 승률이 2밴드 실측을 넘지 못할 것 (지배 전략 차단)
// 리뷰 라운드가 실측한 결함(약속 창 없이는 해가 없음·심기 100% 지배)의 재발 방지 게이트다.

const GAMES = 1200;

interface GamePolicy {
  /** 라운드 선택. windowPattern = 직전 세션이 선언한 패턴 (약속 창 활성 라운드에만 non-null) */
  choose(ctx: { windowPattern: PatternId | null; lastCaught: boolean; lastChoice: Door | null; choices: Door[] }): Door;
  /** 라운드 종료 후 정산 여부 */
  settleNow(ctx: { unsettled: number; streak: number; roundNo: number; windowNext: boolean }): boolean;
}

const other = (d: Door): Door => (d === 'L' ? 'R' : 'L');

/** 읽히는 무전략 — 사람 근사 혼합(반복회피 60/승유지·패전환 40), 선언 무시, 400 넘으면 정산 */
function humanishNaive(rng: () => number): GamePolicy {
  return {
    choose({ lastChoice, lastCaught }) {
      if (rng() < 0.25) return rng() < 0.5 ? 'L' : 'R';
      if (lastChoice === null) return rng() < 0.5 ? 'L' : 'R';
      if (rng() < 0.6) return other(lastChoice); // 반복 회피
      if (!lastCaught && rng() < 0.6) return lastChoice; // 승유지
      return other(lastChoice); // 패전환
    },
    settleNow: ({ unsettled }) => unsettled >= 400,
  };
}
/** 역읽기 — 선언(약속 창)을 역이용: 선언 모델이 기대하는 반대로 간다. 창 직전엔 정산하지 않고
 *  창에서 스트릭을 태운 뒤 600 이상이면 정산 (상식적 정산) */
function counterReader(rng: () => number): GamePolicy {
  const base = humanishNaive(rng);
  let wasWindow = false;
  return {
    choose(ctx) {
      const { windowPattern, lastCaught, lastChoice, choices } = ctx;
      if (windowPattern && lastChoice) {
        switch (windowPattern) {
          case 'ALTERNATE':
            return lastChoice; // 모델은 "반대로 간다"를 기대 → 반복이 역이용
          case 'AFTER_CAUGHT':
            // 모델 기대: 잡힌 뒤엔 도망(반대), 통과 뒤엔 유지(같은 문) → 그 반대로 간다
            return lastCaught ? lastChoice : other(lastChoice);
          case 'FREQ': {
            const l = choices.filter((c) => c === 'L').length;
            return l >= choices.length - l ? 'R' : 'L'; // 편애 문 기대 → 반대 문
          }
          case 'SEQUENCE':
            return lastChoice; // 시퀀스(대개 교대 리듬) 기대 → 반복으로 리듬 파괴
        }
      }
      return base.choose(ctx);
    },
    settleNow({ unsettled, windowNext }) {
      // 상식적 정산: 창이 끝난 직후엔 창에서 태운 스트릭을 반드시 챙긴다. 창 직전엔 정산하지 않는다
      const justEnded = wasWindow && !windowNext;
      wasWindow = windowNext;
      if (windowNext) return false;
      return justEnded ? unsettled > 0 : unsettled >= 600;
    },
  };
}

/** 랜덤 + 무전략 정산(3라운드마다) */
function randomNaive(rng: () => number): GamePolicy {
  return {
    choose: () => (rng() < 0.5 ? 'L' : 'R'),
    settleNow: ({ roundNo }) => roundNo % 3 === 0,
  };
}

/** 심기(sandbag): 패턴을 심고(매판 정산 — 잃을 게 없음) flipAfterMain 라운드 후 반전해 몰아친다
 *  — 리뷰 라운드에서 T=1500 승률 100%였던 지배 전략의 재현 */
function sandbagPolicy(rng: () => number, plant: 'ALT' | 'REPEAT', flipAfterMain: number): GamePolicy {
  const fixed: Door = rng() < 0.5 ? 'L' : 'R';
  let mainCount = 0;
  return {
    choose({ lastChoice }) {
      mainCount++;
      const reversing = mainCount > flipAfterMain;
      if (plant === 'ALT') {
        if (!reversing) return lastChoice === null ? fixed : other(lastChoice);
        return lastChoice ?? fixed; // 반전: 반복
      }
      if (!reversing) return fixed; // 반복 심기
      return lastChoice === null ? fixed : other(lastChoice); // 반전: 교대
    },
    settleNow: ({ streak, unsettled }) => (mainCount <= flipAfterMain ? unsettled > 0 : streak >= 4 || unsettled >= 1000),
  };
}

/** 실게임 러너 — VaultScene과 동일 순서: 라운드 → (정산?) → 세션(폴백 디렉티브) 적용 */
function runGame(policyFactory: (rng: () => number) => GamePolicy, rng: () => number, ensemble: Ensemble, target: number): boolean {
  ensemble.reset();
  const heist = new Heist(ensemble, 1, { target });
  const policy = policyFactory(rng);
  let lastChoice: Door | null = null;
  let lastCaught = false;
  let announced: PatternId | null = null;
  const choices: Door[] = [];

  let s = heist.status();
  while (!s.over) {
    const windowPattern = ensemble.windowActive() ? announced : null;
    const choice = policy.choose({ windowPattern, lastCaught, lastChoice, choices });
    const r = heist.playRound(choice);
    lastChoice = choice;
    lastCaught = r.caught;
    choices.push(choice);

    s = heist.status();
    if (s.over) break;

    const windowNext = ensemble.windowActive();
    if (policy.settleNow({ unsettled: s.unsettled, streak: s.streak, roundNo: r.roundNo, windowNext })) {
      heist.settle();
      s = heist.status();
      if (s.over) break;
    }

    if (s.sessionDue) {
      // LLM 부재 기준선 = 조립형 폴백: 최상위 실존 후보 + BALANCED (스펙 §3.4)
      const top = heist.sessionInput(s.sessionDue).candidates[0];
      heist.applyDirective(top.id, 'BALANCED', 'NONE');
      heist.markSessionDone();
      announced = top.id;
      s = heist.status();
    }
  }
  return s.result === 'WIN';
}

function winRate(policyFactory: (rng: () => number) => GamePolicy, seed: number, target: number): number {
  const rng = createLcg(seed);
  const ensemble = new Ensemble(rng);
  let wins = 0;
  for (let g = 0; g < GAMES; g++) if (runGame(policyFactory, rng, ensemble, target)) wins++;
  return wins / GAMES;
}

function measureAll(target: number) {
  return {
    humanish: winRate(humanishNaive, 101, target),
    counter: winRate(counterReader, 202, target),
    random: winRate(randomNaive, 303, target),
    sandbagAlt: winRate((r) => sandbagPolicy(r, 'ALT', 6), 404, target),
    sandbagRepeat: winRate((r) => sandbagPolicy(r, 'REPEAT', 6), 505, target),
    sandbagAltLate: winRate((r) => sandbagPolicy(r, 'ALT', 7), 606, target),
  };
}

describe(`시뮬 게이트 2차 — 성립 조건 4밴드 (T=${DEFAULT_TARGET}, ${GAMES}게임/정책)`, () => {
  // 스캔 표 — 상수 확정 근거를 검증 로그에 남긴다 (스펙 §3.2)
  for (const t of [900, 1000, 1100, 1200]) {
    const r = measureAll(t);
    // eslint-disable-next-line no-console
    console.log(
      `[T=${t}] humanish ${(r.humanish * 100).toFixed(1)}% · counter ${(r.counter * 100).toFixed(1)}% · random ${(r.random * 100).toFixed(1)}% · sandbagMax ${(Math.max(r.sandbagAlt, r.sandbagRepeat, r.sandbagAltLate) * 100).toFixed(1)}%`,
    );
  }
  const rates = measureAll(DEFAULT_TARGET);
  // eslint-disable-next-line no-console
  console.log('[게이트 2차 실측 — 확정 T]', JSON.stringify(rates, null, 1));

  it('밴드 1 — 읽히는 무전략 승률 < 15%', () => {
    expect(rates.humanish).toBeLessThan(0.15);
  });

  it('밴드 2 — 역읽기(약속 창 활용) 승률 45~70%', () => {
    expect(rates.counter).toBeGreaterThanOrEqual(0.45);
    expect(rates.counter).toBeLessThanOrEqual(0.7);
  });

  it('밴드 3 — 랜덤+무전략 정산 승률 10~30%', () => {
    expect(rates.random).toBeGreaterThanOrEqual(0.1);
    expect(rates.random).toBeLessThanOrEqual(0.3);
  });

  it('밴드 4 — 심기 정책군 최고 승률이 역읽기를 넘지 못한다 (지배 전략 차단)', () => {
    const sandbagMax = Math.max(rates.sandbagAlt, rates.sandbagRepeat, rates.sandbagAltLate);
    expect(sandbagMax).toBeLessThan(rates.counter);
    expect(sandbagMax).toBeLessThan(0.7);
  });

  it('관찰 라운드 상수 확인 — 레이아웃 드리프트 방지', () => {
    expect(OBS_ROUNDS).toBe(1);
  });
});
