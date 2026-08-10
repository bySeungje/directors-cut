import { describe, it, expect } from 'vitest';
import { canDamageEnforcer, enforcerPosition, CLOSE_RANGE_PX, ENFORCER_HP } from '../src/game/enforcerRule';
import { CARDINALS } from '../src/game/warning';

/**
 * 집행자가 지키는 것은 밸런스가 아니라 **성질**이다 — 멀리서는 안 통하고, 예고한 자리에 서고,
 * 아레나 안쪽이라 접근이 가능해야 한다. 이 셋 중 하나라도 깨지면 "다가가야 하는 적"이 성립하지 않는다.
 */
describe('집행자 — 다가가야만 깨진다', () => {
  it('사거리 밖에서 쏜 탄은 통하지 않는다', () => {
    expect(canDamageEnforcer(CLOSE_RANGE_PX + 1)).toBe(false);
    expect(canDamageEnforcer(400)).toBe(false);
  });

  it('사거리 안(경계 포함)에서는 통한다', () => {
    expect(canDamageEnforcer(CLOSE_RANGE_PX)).toBe(true);
    expect(canDamageEnforcer(0)).toBe(true);
  });

  it('붙어서 몇 초면 깨진다 — 오래 때리는 것이 목적이 아니다', () => {
    expect(ENFORCER_HP).toBeLessThanOrEqual(8);
  });
});

describe('집행자 — 예고한 자리에 선다', () => {
  const W = 960, H = 640;

  it('네 방향 모두 그 방면 쪽에 선다', () => {
    expect(enforcerPosition('W', W, H).x).toBeLessThan(W / 2);
    expect(enforcerPosition('E', W, H).x).toBeGreaterThan(W / 2);
    expect(enforcerPosition('N', W, H).y).toBeLessThan(H / 2);
    expect(enforcerPosition('S', W, H).y).toBeGreaterThan(H / 2);
  });

  it('벽에 붙지 않는다 — 붙으면 등 뒤로 접근할 수 없어 "붙어서 깬다"가 성립하지 않는다', () => {
    for (const d of CARDINALS) {
      const p = enforcerPosition(d, W, H);
      expect(p.x).toBeGreaterThan(CLOSE_RANGE_PX * 0.5);
      expect(p.x).toBeLessThan(W - CLOSE_RANGE_PX * 0.5);
      expect(p.y).toBeGreaterThan(CLOSE_RANGE_PX * 0.5);
      expect(p.y).toBeLessThan(H - CLOSE_RANGE_PX * 0.5);
    }
  });

  it('같은 방향이면 항상 같은 자리 — 예고와 위치가 어긋날 수 없다', () => {
    const a = enforcerPosition('W', W, H);
    const b = enforcerPosition('W', W, H);
    expect(a).toEqual(b);
  });

  it('네 방향이 서로 다른 자리다', () => {
    const seen = new Set(CARDINALS.map((d) => JSON.stringify(enforcerPosition(d, W, H))));
    expect(seen.size).toBe(4);
  });
});
