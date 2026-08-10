import { describe, it, expect } from 'vitest';
import {
  nextMultiplier, killGain, chooseDeprivation, DEPRIVATION_WORD,
  MULT_START, MULT_MIN, MULT_MAX, KILL_SCORE,
} from '../src/game/settlement';

/**
 * 배수는 **읽기에 붙는 수치**다. 이 테스트가 지키는 것은 밸런스 값이 아니라 그 성질이다 —
 * 잘 쏴서 오르면 안 되고(킬은 배수를 못 움직인다), 예고를 깨야 오른다.
 */
describe('배수 정산', () => {
  it('예고를 깨면 오르고 적중당하면 내린다', () => {
    expect(nextMultiplier(1.0, 'BROKEN')).toBeCloseTo(1.5);
    expect(nextMultiplier(2.0, 'HIT')).toBeCloseTo(1.7);
  });

  it('무효 판정은 배수를 움직이지 않는다 — 디렉터가 지표를 강제한 웨이브는 이득도 손해도 없다', () => {
    expect(nextMultiplier(2.4, 'VOID')).toBeCloseTo(2.4);
  });

  it('하한 아래로 내려가지 않는다 — 벌점이 누적돼 회복 불가가 되면 안 된다', () => {
    let m = MULT_START;
    for (let i = 0; i < 20; i++) m = nextMultiplier(m, 'HIT');
    expect(m).toBe(MULT_MIN);
  });

  it('상한을 넘지 않는다', () => {
    let m = MULT_START;
    for (let i = 0; i < 50; i++) m = nextMultiplier(m, 'BROKEN');
    expect(m).toBe(MULT_MAX);
  });

  it('예고를 계속 깨면 7웨이브 안에 상한에 닿지 않는다 — 끝까지 올릴 여지가 남아야 한다', () => {
    let m = MULT_START;
    for (let i = 0; i < 6; i++) m = nextMultiplier(m, 'BROKEN'); // 웨이브 1은 관찰 라운드라 판정 6회
    expect(m).toBeLessThan(MULT_MAX);
  });

  it('시작 배수가 하한보다 위다 — 아니면 첫 적중이 화면에서 아무 일도 아니게 된다', () => {
    // Playwright 실측(2026-08-10): 하한에서 시작하니 100초 동안 배수가 한 번도 안 움직였다.
    // 심사자가 60초만 플레이해도 정산이 양방향으로 보여야 한다.
    expect(MULT_START).toBeGreaterThan(MULT_MIN);
    expect(nextMultiplier(MULT_START, 'HIT')).toBeLessThan(MULT_START);
    expect(nextMultiplier(MULT_START, 'BROKEN')).toBeGreaterThan(MULT_START);
  });

  it('처치 점수는 현재 배수에 비례한다 — 시차 0으로 즉시 오른다', () => {
    expect(killGain(1.0)).toBe(KILL_SCORE);
    expect(killGain(2.5)).toBe(Math.round(KILL_SCORE * 2.5));
  });

  it('킬은 배수를 움직이지 못한다 — 배수를 바꾸는 입력은 판정뿐이다', () => {
    // nextMultiplier의 인자는 (현재값, 판정) 둘뿐이다. 킬 수·명중률·웨이브 번호가 들어갈 자리가 없다.
    expect(nextMultiplier.length).toBe(2);
  });
});

describe('박탈 — 강화가 아니라, 기대는 것을 골라 빼앗는다', () => {
  const plain = { dashUptime: 0.1, multishot: 1, accuracy: 0.9 };

  it('예고를 깨면 아무것도 잃지 않는다 — 읽는 것이 곧 능력을 지키는 일이다', () => {
    expect(chooseDeprivation('BROKEN', plain)).toBe(null);
    expect(chooseDeprivation('VOID', plain)).toBe(null);
  });

  it('대시에 기대면 대시를 가져간다', () => {
    expect(chooseDeprivation('HIT', { ...plain, dashUptime: 0.8 })).toBe('DASH_LOCK');
  });

  it('다중 발사를 들고 있으면 그것을 봉인한다', () => {
    expect(chooseDeprivation('HIT', { ...plain, multishot: 3 })).toBe('NO_MULTI');
  });

  it('난사로 커버하면 연사를 절반으로 만든다', () => {
    expect(chooseDeprivation('HIT', { ...plain, accuracy: 0.3 })).toBe('SLOW_FIRE');
  });

  it('무엇에도 두드러지게 기대지 않으면 가장 보편적인 의존(대시)으로 떨어진다', () => {
    expect(chooseDeprivation('HIT', plain)).toBe('DASH_LOCK');
  });

  it('같은 사람에게 항상 같은 것을 뺏지 않는다 — 기대는 것이 바뀌면 뺏는 것도 바뀐다', () => {
    const picks = new Set([
      chooseDeprivation('HIT', { dashUptime: 0.9, multishot: 1, accuracy: 0.9 }),
      chooseDeprivation('HIT', { dashUptime: 0.1, multishot: 3, accuracy: 0.9 }),
      chooseDeprivation('HIT', { dashUptime: 0.1, multishot: 1, accuracy: 0.2 }),
    ]);
    expect(picks.size).toBe(3);
  });

  it('모든 박탈이 사람 말 이름을 갖는다 — 화면과 로그가 같은 단어를 쓴다', () => {
    for (const k of ['DASH_LOCK', 'NO_MULTI', 'SLOW_FIRE'] as const) {
      expect(DEPRIVATION_WORD[k].length).toBeGreaterThan(0);
    }
  });

  it('박탈은 전부 플레이어 상태다 — 변주로 빼앗으면 판정이 VOID가 되고 배수가 영원히 멈춘다', () => {
    // docs/_hub/nodes/C-mutation-judge-collision.md. ANCHOR는 LAVA_HOTSPOT에, CORNER는
    // LAVA_LEFT/RIGHT에 무효 처리되도록 이미 등재돼 있다 — 용암으로 자리를 뺏었다면 정산이 죽었다.
    const all = ['DASH_LOCK', 'NO_MULTI', 'SLOW_FIRE', null];
    for (const v of ['HIT', 'BROKEN', 'VOID'] as const) {
      expect(all).toContain(chooseDeprivation(v, plain));
    }
  });
});
