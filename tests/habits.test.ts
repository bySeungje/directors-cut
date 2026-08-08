import { describe, it, expect } from 'vitest';
import {
  HABIT_IDS, HABITS, BROKEN_RATIO, detectHabit, judge, meterFill,
  type HabitReading, type HabitId,
} from '../src/game/habits';
import { MUTATIONS } from '../src/contracts/directive';

const at = (over: Partial<HabitReading> = {}): HabitReading =>
  ({ corner: 0, anchor: 0, dashRate: 0, ...over });

/** 해당 습관만 임계를 넘긴 입력 */
const only = (id: HabitId, mult = 1.2): HabitReading => {
  const t = HABITS[id].threshold * mult;
  return at(id === 'ANCHOR' ? { anchor: t } : id === 'CORNER' ? { corner: t } : { dashRate: t });
};

describe('습관 어휘', () => {
  it('3종이고 전부 명제·라벨·근거 표시를 갖는다', () => {
    expect(HABIT_IDS).toHaveLength(3);
    for (const id of HABIT_IDS) {
      expect(HABITS[id].claim.length).toBeGreaterThan(0);
      expect(HABITS[id].label.length).toBeGreaterThan(0);
      expect(HABITS[id].evidence(only(id)).length).toBeGreaterThan(0);
    }
  });

  it('무효 변주는 전부 계약 enum 안의 값이다', () => {
    for (const id of HABIT_IDS) for (const m of HABITS[id].voidedBy) expect(MUTATIONS).toContain(m);
  });

  it('폐기된 HERD·WALL이 되살아나지 않는다', () => {
    expect(HABIT_IDS).not.toContain('HERD' as HabitId);
    expect(HABIT_IDS).not.toContain('WALL' as HabitId);
  });
});

describe('detectHabit — 우선순위 고정', () => {
  it('아무것도 임계를 못 넘으면 null (잘 움직이는 플레이어)', () => {
    expect(detectHabit(at({ corner: 0.25, anchor: 0.10, dashRate: 0.05 }))).toBeNull();
  });

  it('넘긴 것이 하나면 그것을 고른다', () => {
    for (const id of HABIT_IDS) expect(detectHabit(only(id))).toBe(id);
  });

  // 격자가 사분면에 4x3으로 내포돼 anchor <= corner가 항상 성립한다. 초과율로 비교하면
  // ANCHOR가 원리적으로 선택되지 못한다 — 우선순위 고정이 그것을 막는다.
  it('ANCHOR와 CORNER가 동시에 넘기면 ANCHOR가 이긴다 — 초과율은 항상 CORNER가 크다', () => {
    const r = at({ anchor: 0.49, corner: 1.00 });
    expect(HABITS.CORNER.read(r) / HABITS.CORNER.threshold)
      .toBeGreaterThan(HABITS.ANCHOR.read(r) / HABITS.ANCHOR.threshold);
    expect(detectHabit(r)).toBe('ANCHOR');
  });

  it('직전과 같은 습관은 피한다', () => {
    const r = at({ anchor: 0.5, corner: 0.6 });
    expect(detectHabit(r, null)).toBe('ANCHOR');
    expect(detectHabit(r, 'ANCHOR')).toBe('CORNER');
  });

  it('직전 것 말고 넘긴 게 없으면 그대로 쓴다 — 억지로 바꾸면 임계 미달을 예측하게 된다', () => {
    expect(detectHabit(only('DASH'), 'DASH')).toBe('DASH');
  });
});

describe('judge — 히스테리시스와 무효', () => {
  it('임계 이상이면 적중', () => {
    for (const id of HABIT_IDS) expect(judge(id, only(id), 'NONE')).toBe('HIT');
  });

  it('임계 × 0.85 아래면 플레이어 승', () => {
    for (const id of HABIT_IDS) expect(judge(id, only(id, BROKEN_RATIO - 0.05), 'NONE')).toBe('BROKEN');
  });

  it('임계와 0.85 사이는 무효 — 반올림 잡음으로 뒤집히지 않게', () => {
    for (const id of HABIT_IDS) expect(judge(id, only(id, 0.92), 'NONE')).toBe('VOID');
  });

  // 용암 경계 x<w/2가 사분면 경계와 같은 선이라, 용암을 피하면 비둘기집 원리로
  // max(quadrantTime) >= 0.50이 확정된다 — 플레이어 행동과 무관한 적중.
  it('CORNER는 좌우 용암 웨이브에서 무효다 — 값이 아무리 높아도', () => {
    expect(judge('CORNER', at({ corner: 1.0 }), 'LAVA_LEFT')).toBe('VOID');
    expect(judge('CORNER', at({ corner: 1.0 }), 'LAVA_RIGHT')).toBe('VOID');
    expect(judge('CORNER', at({ corner: 1.0 }), 'FOG')).toBe('HIT');
  });

  it('ANCHOR는 핫스팟 웨이브에서 무효다 — 자리를 뜨는 게 플레이어의 판단이 아니라 강제라서', () => {
    expect(judge('ANCHOR', at({ anchor: 0.0 }), 'LAVA_HOTSPOT')).toBe('VOID');
    expect(judge('ANCHOR', at({ anchor: 0.0 }), 'NONE')).toBe('BROKEN');
  });

  it('DASH는 어떤 변주로도 무효화되지 않는다 — 변주가 대시를 강제하지 않는다', () => {
    for (const m of MUTATIONS) expect(judge('DASH', only('DASH'), m)).toBe('HIT');
  });
});

describe('meterFill', () => {
  it('임계에서 정확히 1.0', () => {
    for (const id of HABIT_IDS) expect(meterFill(id, only(id, 1))).toBeCloseTo(1.0, 5);
  });
  it('0 이상 1.2 이하로 클램프된다 — 막대가 터지지 않게', () => {
    for (const id of HABIT_IDS) {
      expect(meterFill(id, only(id, 10))).toBe(1.2);
      expect(meterFill(id, at())).toBe(0);
    }
  });
});
