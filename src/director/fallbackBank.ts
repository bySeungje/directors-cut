import type { PatternCandidate, SessionDirective } from '../contracts/directive';

// ── 조립형 폴백 (스펙 §3.4 — 정적 단일 템플릿 금지) ─────────────────────────
// LLM이 죽어도 "실제 이력 지목"은 유지된다: read는 엔진의 최상위 실존 후보에서 조립한다.
// 약속 창도 그대로 열린다 — 폴백은 목소리의 결만 잃는다.

const SESSION_TAUNTS: readonly string[][] = [
  [
    '버릇은 숨긴다고 없어지지 않아.',
    '네 손이 먼저 말하고 있다.',
    '읽는 데 세 판이면 충분했다.',
  ],
  [
    '아직도 같은 손버릇이군.',
    '금고가 아니라 네 머릿속을 열고 있다.',
    '슬슬 도망칠 타이밍인데. 못 하겠지.',
  ],
  [
    '마지막 구간이다. 네 패는 다 읽었다.',
    '여기서부터는 자비 없다.',
    '도망칠 문까지 계산에 넣었다.',
  ],
];

/** 세션 폴백: 최상위 후보의 통계를 그대로 선언한다 (읽기의 진실성은 폴백에서도 계약이다) */
export function assembleSessionFallback(candidates: PatternCandidate[], sessionNo: 1 | 2 | 3, pick: number): SessionDirective {
  const top = candidates[0];
  const taunts = SESSION_TAUNTS[sessionNo - 1];
  return {
    readPatternId: top.id,
    read: top.evidence,
    taunt: taunts[Math.abs(pick) % taunts.length],
    strategy: 'BALANCED',
    baitDoor: 'NONE',
    intent: '통계 폴백 — 최상위 실존 패턴 선언',
  };
}
