import { describe, expect, it } from 'vitest';
import { validateSessionDirective } from '../src/director/validator';
import { assembleSessionFallback } from '../src/director/fallbackBank';
import { assembleReport } from '../src/director/report';
import { READ_MAX, type PatternCandidate, type ReportInput } from '../src/contracts/directive';

// 디렉티브 v2 검증·폴백 조립 (스펙 §3.4, 완료 기준 6)

const CANDIDATE_IDS = ['ALTERNATE', 'FREQ'] as const;

const valid = {
  readPatternId: 'ALTERNATE',
  read: '같은 문을 두 번 안 가는 버릇, 이미 읽었다',
  taunt: '슬슬 챙기고 싶어 손이 근질거리지?',
  strategy: 'BALANCED',
  baitDoor: 'NONE',
  intent: '교대 패턴 선언 후 기본 앙상블 유지',
};

describe('validateSessionDirective', () => {
  it('유효한 디렉티브는 그대로 통과한다', () => {
    const d = validateSessionDirective(valid, [...CANDIDATE_IDS]);
    expect(d).not.toBeNull();
    expect(d!.readPatternId).toBe('ALTERNATE');
  });

  it('길이 초과는 폴백이 아니라 절단이다 (전작 validator의 결정 승계)', () => {
    const long = { ...valid, read: '가'.repeat(READ_MAX + 30) };
    const d = validateSessionDirective(long, [...CANDIDATE_IDS]);
    expect(d).not.toBeNull();
    expect(d!.read.length).toBeLessThanOrEqual(READ_MAX);
    expect(d!.read.endsWith('…')).toBe(true);
  });

  it('BAIT가 아닌데 baitDoor가 있으면 NONE으로 정규화한다', () => {
    const d = validateSessionDirective({ ...valid, baitDoor: 'L' }, [...CANDIDATE_IDS]);
    expect(d).not.toBeNull();
    expect(d!.baitDoor).toBe('NONE');
  });

  it('BAIT인데 baitDoor가 NONE이면 BALANCED로 정규화한다', () => {
    const d = validateSessionDirective({ ...valid, strategy: 'BAIT', baitDoor: 'NONE' }, [...CANDIDATE_IDS]);
    expect(d).not.toBeNull();
    expect(d!.strategy).toBe('BALANCED');
  });

  it('후보 밖 readPatternId는 날조 — 그 세션은 폴백(null)', () => {
    const d = validateSessionDirective({ ...valid, readPatternId: 'AFTER_CAUGHT' }, [...CANDIDATE_IDS]);
    expect(d).toBeNull();
  });

  it('구조 위반(필드 누락·비객체)은 폴백(null)', () => {
    expect(validateSessionDirective(null, [...CANDIDATE_IDS])).toBeNull();
    expect(validateSessionDirective('text', [...CANDIDATE_IDS])).toBeNull();
    const { taunt: _omit, ...missing } = valid;
    expect(validateSessionDirective(missing, [...CANDIDATE_IDS])).toBeNull();
  });
});

describe('조립형 폴백 (스펙 §3.4 — 폴백에서도 실제 이력 지목 유지)', () => {
  const candidates: PatternCandidate[] = [
    { id: 'ALTERNATE', evidence: '같은 문을 두 번 안 가는 버릇 — 5번 중 4번', score: 0.4 },
    { id: 'FREQ', evidence: '5번 중 4번 왼쪽만 골랐다', score: 0.3 },
  ];

  it('세션 폴백은 최상위 실존 후보를 그대로 선언한다', () => {
    const d = assembleSessionFallback(candidates, 1, 3);
    expect(d.readPatternId).toBe('ALTERNATE');
    expect(d.read).toBe(candidates[0].evidence);
    expect(d.strategy).toBe('BALANCED');
    expect(d.taunt.length).toBeGreaterThan(0);
  });

  it('리포트 폴백은 통계에서 조립된다 — 정적 단일 템플릿 금지', () => {
    const base: ReportInput = {
      result: 'LOSE', earlyEnd: null, roundsPlayed: 12, bank: 600, target: 1000,
      caughtCount: 7, bestStreak: 3, settleCount: 2, greedRounds: 1,
      caughtByPattern: { ALTERNATE: 5, FREQ: 2 }, windowRounds: 6, windowPasses: 1, runCount: 1,
    };
    const a = assembleReport(base);
    const b = assembleReport({ ...base, result: 'WIN', bank: 1200, windowPasses: 5, caughtCount: 2 });
    expect(a.body).not.toBe(b.body); // 입력이 다르면 리포트도 다르다
    expect(a.body).toContain('7번'); // 실제 수치 인용
    expect(a.title.length).toBeGreaterThan(0);
    expect(b.title.length).toBeGreaterThan(0);
  });
});
