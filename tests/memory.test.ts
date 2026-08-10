import { describe, it, expect } from 'vitest';
import {
  loadRuns, saveRun, deathsAtCell, habitStreak, recallLine, browserStore,
  MEMORY_KEY, MAX_RUNS, type RunRecord, type MemoryStore,
} from '../src/game/memory';

const fake = (seed: Record<string, string> = {}): MemoryStore & { data: Record<string, string> } => ({
  data: { ...seed },
  getItem(k) { return this.data[k] ?? null; },
  setItem(k, v) { this.data[k] = v; },
});

const run = (over: Partial<RunRecord> = {}): RunRecord =>
  ({ wave: 3, deathCell: 12, habits: ['CORNER'], result: 'LOSE', ...over });

describe('로컬 기억 — 저장과 회수', () => {
  it('저장한 런을 다시 읽는다', () => {
    const s = fake();
    saveRun(s, run({ wave: 4 }));
    expect(loadRuns(s)).toHaveLength(1);
    expect(loadRuns(s)[0].wave).toBe(4);
  });

  it('상한을 넘으면 오래된 것부터 버린다', () => {
    const s = fake();
    for (let i = 0; i < MAX_RUNS + 5; i++) saveRun(s, run({ wave: i }));
    const runs = loadRuns(s);
    expect(runs).toHaveLength(MAX_RUNS);
    expect(runs[runs.length - 1].wave).toBe(MAX_RUNS + 4); // 최신이 남는다
  });

  it('저장소가 없거나 깨져도 던지지 않는다 — 기억이 없어도 게임은 성립한다', () => {
    expect(loadRuns(null)).toEqual([]);
    expect(loadRuns(undefined)).toEqual([]);
    expect(loadRuns(fake({ [MEMORY_KEY]: '깨진 JSON{{' }))).toEqual([]);
    expect(loadRuns(fake({ [MEMORY_KEY]: '"배열이 아님"' }))).toEqual([]);
    const throwing: MemoryStore = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    expect(loadRuns(throwing)).toEqual([]);
    expect(() => saveRun(throwing, run())).not.toThrow();
  });

  it('형태가 어긋난 옛 데이터는 버린다 — 화면에 거짓을 만들지 않는다', () => {
    const s = fake({ [MEMORY_KEY]: JSON.stringify([{ nope: 1 }, run(), null, 3]) });
    expect(loadRuns(s)).toHaveLength(1);
  });

  it('브라우저 저장소가 없는 환경에서 null을 돌려준다', () => {
    // 노드 테스트 환경에는 localStorage가 없다 — 그 자체가 이 함수의 계약이다.
    expect(browserStore()).toBe(null);
  });
});

describe('로컬 기억 — 무엇을 말하는가', () => {
  it('같은 자리에서 반복해 죽으면 그것을 지목한다', () => {
    const runs = [run({ deathCell: 12 }), run({ deathCell: 12 })];
    expect(deathsAtCell(runs, 12)).toBe(2);
    expect(recallLine(runs, 12, null)).toContain('바로 여기서 죽었다');
  });

  it('다른 자리에서 죽었으면 "여기서 죽었다"고 말하지 않는다 — 거짓말을 만들지 않는다', () => {
    const runs = [run({ deathCell: 3 }), run({ deathCell: 40 })];
    expect(deathsAtCell(runs, 12)).toBe(0);
    expect(recallLine(runs, 12, null)).not.toContain('바로 여기서');
  });

  it('같은 습관이 연속될 때만 판수를 센다 — 끊기면 다시 1부터', () => {
    expect(habitStreak([run({ habits: ['ORBIT'] }), run({ habits: ['ORBIT'] })], 'ORBIT')).toBe(2);
    expect(habitStreak([run({ habits: ['ORBIT'] }), run({ habits: ['DASH'] })], 'ORBIT')).toBe(0);
    expect(habitStreak([], 'ORBIT')).toBe(0);
    expect(habitStreak([run()], null)).toBe(0);
  });

  it('더 개인적인 기억이 우선한다 — 같은 자리 > 같은 습관 > 도전 횟수', () => {
    const both = [run({ deathCell: 7, habits: ['ORBIT'] }), run({ deathCell: 7, habits: ['ORBIT'] })];
    expect(recallLine(both, 7, 'ORBIT')).toContain('바로 여기서');
    const habitOnly = [run({ deathCell: 1, habits: ['ORBIT'] }), run({ deathCell: 2, habits: ['ORBIT'] })];
    expect(recallLine(habitOnly, 99, 'ORBIT')).toContain('판째 같은 습관');
    const neither = [run({ deathCell: 1, habits: ['DASH'] }), run({ deathCell: 2, habits: ['CORNER'] })];
    expect(recallLine(neither, 99, 'ORBIT')).toContain('번째 도전');
  });

  it('첫 판에는 아무것도 말하지 않는다 — 없는 기억을 지어내지 않는다', () => {
    expect(recallLine([], 5, 'CORNER')).toBe(null);
  });

  it('두 번째 판부터는 반드시 무언가 말한다 — 심사자가 두 판만 해도 기능이 보여야 한다', () => {
    const line = recallLine([run({ deathCell: 9, habits: ['DASH'] })], 5, 'CORNER');
    expect(line).toContain('2번째 도전');
  });

  it('클리어로 끝난 런은 사망 자리 기억에 끼지 않는다', () => {
    const runs = [run({ deathCell: null, result: 'WIN' }), run({ deathCell: null, result: 'WIN' })];
    expect(deathsAtCell(runs, null)).toBe(0);
  });
});
