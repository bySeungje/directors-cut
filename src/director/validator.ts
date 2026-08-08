import {
  INTENT_MAX, READ_MAX, SessionDirectiveSchema, TAUNT_MAX,
  type PatternId, type SessionDirective,
} from '../contracts/directive';

// ── 디렉티브 v2 검증 (스펙 §3.4) ────────────────────────────────────────────
// 전작 validator가 코드에 남긴 결정 승계: 길이 초과는 거부가 아니라 **절단**이다 —
// structured outputs가 maxLength를 강제하지 못해 한국어 응답이 상습 초과하는데,
// 그때마다 폴백으로 떨어지면 LLM이 쓴 read·taunt를 잃는다(핵심 순간의 손실).
// 폴백 사유는 구조·enum 위반과 후보 밖 readPatternId(날조)뿐.

const truncate = (s: unknown, max: number): unknown =>
  typeof s === 'string' && s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;

/** 원시 응답 → 정규화된 세션 디렉티브. null = 폴백 사용 */
export function validateSessionDirective(raw: unknown, candidateIds: PatternId[]): SessionDirective | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = { ...(raw as Record<string, unknown>) };

  r.read = truncate(r.read, READ_MAX);
  r.taunt = truncate(r.taunt, TAUNT_MAX);
  r.intent = truncate(r.intent, INTENT_MAX);
  // baitDoor는 BAIT일 때만 유효 — 조건 위반은 거부가 아니라 정규화 (리뷰 should-fix)
  if (r.strategy !== 'BAIT') r.baitDoor = 'NONE';
  if (r.strategy === 'BAIT' && (r.baitDoor === 'NONE' || r.baitDoor == null)) r.strategy = 'BALANCED';

  const parsed = SessionDirectiveSchema.safeParse(r);
  if (!parsed.success) return null;
  // 날조 차단 (스펙 §3.4): 엔진이 준 실존 후보 밖의 패턴 선언은 그 세션을 폴백으로
  if (!candidateIds.includes(parsed.data.readPatternId)) return null;
  return parsed.data;
}
