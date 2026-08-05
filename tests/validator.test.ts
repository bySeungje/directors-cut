import { describe, it, expect } from 'vitest';
import { validateDirective, budgetFor, costOf } from '../src/director/validator';

const ok = {
  composition: [{ type: 'chaser', count: 8, spawn: 'N', elite: false }],
  mutation: 'FOG', taunt: '벽에 붙는 습관, 봤다.', intent: '벽면 회피 차단',
};

describe('validateDirective', () => {
  it('정상 디렉티브 통과', () => {
    expect(validateDirective(ok, 3, 'NONE')).not.toBeNull();
  });
  it('enum 밖 값 거부', () => {
    expect(validateDirective({ ...ok, mutation: 'EARTHQUAKE' }, 3, 'NONE')).toBeNull();
  });
  it('taunt 60자 초과 거부', () => {
    expect(validateDirective({ ...ok, taunt: '가'.repeat(61) }, 3, 'NONE')).toBeNull();
  });
  it('예산 초과 거부: 웨이브3 상한을 넘는 엘리트 물량', () => {
    const over = { ...ok, composition: [{ type: 'splitter', count: 30, spawn: 'RING', elite: true }] };
    expect(validateDirective(over, 3, 'NONE')).toBeNull();
  });
  it('동일 mutation 2연속이면 mutation을 NONE으로 강제 교체(거부 아님)', () => {
    const v = validateDirective(ok, 3, 'FOG');
    expect(v).not.toBeNull();
    expect(v!.mutation).toBe('NONE');
  });
  it('count 0 이하·비정수 거부', () => {
    expect(validateDirective({ ...ok, composition: [{ type: 'chaser', count: 0, spawn: 'N', elite: false }] }, 3, 'NONE')).toBeNull();
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
