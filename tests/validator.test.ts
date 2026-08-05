import { describe, it, expect } from 'vitest';
import { validateDirective, budgetFor, costOf, buffCostOf } from '../src/director/validator';

const ok = {
  composition: [{ type: 'chaser', count: 8, spawn: 'N', elite: false }],
  mutation: 'FOG', taunt: '벽에 붙는 습관, 봤다.', intent: '벽면 회피 차단', buff: 'NONE',
};

describe('validateDirective', () => {
  it('정상 디렉티브 통과', () => {
    expect(validateDirective(ok, 3, 'NONE', 'NONE')).not.toBeNull();
  });
  it('enum 밖 값 거부', () => {
    expect(validateDirective({ ...ok, mutation: 'EARTHQUAKE' }, 3, 'NONE', 'NONE')).toBeNull();
  });
  it('taunt 60자 초과 거부', () => {
    expect(validateDirective({ ...ok, taunt: '가'.repeat(61) }, 3, 'NONE', 'NONE')).toBeNull();
  });
  it('예산 초과 거부: 웨이브3 상한을 넘는 엘리트 물량', () => {
    const over = { ...ok, composition: [{ type: 'splitter', count: 30, spawn: 'RING', elite: true }] };
    expect(validateDirective(over, 3, 'NONE', 'NONE')).toBeNull();
  });
  it('동일 mutation 2연속이면 mutation을 NONE으로 강제 교체(거부 아님)', () => {
    const v = validateDirective(ok, 3, 'FOG', 'NONE');
    expect(v).not.toBeNull();
    expect(v!.mutation).toBe('NONE');
  });
  it('count 0 이하·비정수 거부', () => {
    expect(validateDirective({ ...ok, composition: [{ type: 'chaser', count: 0, spawn: 'N', elite: false }] }, 3, 'NONE', 'NONE')).toBeNull();
  });
});

describe('budget', () => {
  it('예산은 웨이브에 따라 단조 증가', () => {
    for (let w = 1; w < 7; w++) expect(budgetFor(w + 1)).toBeGreaterThan(budgetFor(w));
  });
  it('비용: chaser 1, shooter 2, splitter 2, elite ×3', () => {
    expect(costOf({ type: 'chaser', count: 4, spawn: 'N', elite: false })).toBe(4);
    expect(costOf({ type: 'shooter', count: 2, spawn: 'N', elite: true })).toBe(12);
  });
});

describe('강화 카드', () => {
  it('buff 필드가 없으면 거부', () => {
    const { buff, ...noBuff } = { ...ok };
    expect(validateDirective(noBuff, 3, 'NONE', 'NONE')).toBeNull();
  });
  it('enum 밖 카드 거부', () => {
    expect(validateDirective({ ...ok, buff: 'GODMODE' }, 3, 'NONE', 'NONE')).toBeNull();
  });
  it('NONE 비용은 0, 그 외는 예산의 25% 반올림', () => {
    expect(buffCostOf('NONE', 3)).toBe(0);
    expect(buffCostOf('TOUGH', 3)).toBe(Math.round(budgetFor(3) * 0.25));
    expect(buffCostOf('SWIFT', 7)).toBe(Math.round(budgetFor(7) * 0.25));
  });
  it('buff 비용이 예산에 합산돼 초과분을 거부한다', () => {
    // 웨이브 3 예산 20, buff 비용 5 → composition 상한은 15
    const near = { ...ok, composition: [{ type: 'chaser', count: 16, spawn: 'N', elite: false }], buff: 'TOUGH' };
    expect(validateDirective(near, 3, 'NONE', 'NONE')).toBeNull();
    const fits = { ...ok, composition: [{ type: 'chaser', count: 15, spawn: 'N', elite: false }], buff: 'TOUGH' };
    expect(validateDirective(fits, 3, 'NONE', 'NONE')).not.toBeNull();
  });
  it('buff 없이는 예산 전액을 composition에 쓸 수 있다', () => {
    const full = { ...ok, composition: [{ type: 'chaser', count: 20, spawn: 'N', elite: false }], buff: 'NONE' };
    expect(validateDirective(full, 3, 'NONE', 'NONE')).not.toBeNull();
  });
  it('직전과 같은 카드는 NONE으로 강제 교체(거부 아님)', () => {
    const v = validateDirective({ ...ok, buff: 'TOUGH' }, 3, 'NONE', 'TOUGH');
    expect(v).not.toBeNull();
    expect(v!.buff).toBe('NONE');
  });
  it('직전이 NONE이면 NONE을 다시 써도 통과', () => {
    const v = validateDirective({ ...ok, buff: 'NONE' }, 3, 'NONE', 'NONE');
    expect(v!.buff).toBe('NONE');
  });
  it('직전과 다른 카드는 유지', () => {
    const v = validateDirective({ ...ok, buff: 'SWIFT' }, 3, 'NONE', 'TOUGH');
    expect(v!.buff).toBe('SWIFT');
  });
});
