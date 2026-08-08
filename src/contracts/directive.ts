import { z } from 'zod';

// ── 수읽기 계약 v2 (스펙 §3.4) ──────────────────────────────────────────────
// 원칙: LLM에게는 어휘를, 집행은 결정론으로. LLM은 수치·확률을 정하지 못한다.
// ⚠️ supabase/functions/director/index.ts에 DIRECTIVE_JSON_SCHEMA의 수동 사본이 있다
//    (별도 번들·타입체크 밖). 이 파일 변경 시 반드시 함께 갱신할 것 (CLAUDE.md).

export const DOORS = ['L', 'R'] as const;
export type Door = (typeof DOORS)[number];

/** 읽기 세션이 선언할 수 있는 패턴 어휘 = 예측기 5종 중 표시 가능한 4종.
 *  엔진이 현재 통계로 산출한 "실존 후보"만 LLM에 제시되며, LLM은 그중에서 고른다(날조 구조 차단).
 *  선언된 패턴은 약속 창(다음 2라운드)의 실제 덫 정책이 된다 — 스펙 §3.4 "말한 읽기는 지킨다". */
export const PATTERN_IDS = ['FREQ', 'ALTERNATE', 'SEQUENCE', 'AFTER_CAUGHT'] as const;
export type PatternId = (typeof PATTERN_IDS)[number];

/** 창 종료 후 적응 앙상블의 프리셋 어휘. 가중치 수치는 엔진(predictor.ts) 소유. */
export const STRATEGIES = ['BALANCED', 'PRIOR_HEAVY', 'RECENT_ONLY', 'PATTERN_HEAVY', 'CONTRARIAN', 'BAIT'] as const;
export type Strategy = (typeof STRATEGIES)[number];

export const BAIT_DOORS = ['L', 'R', 'NONE'] as const;
export type BaitDoor = (typeof BAIT_DOORS)[number];

export const READ_MAX = 60;
export const TAUNT_MAX = 40;
export const INTENT_MAX = 80;

export const SessionDirectiveSchema = z.object({
  readPatternId: z.enum(PATTERN_IDS),
  read: z.string().min(1).max(READ_MAX),
  taunt: z.string().min(1).max(TAUNT_MAX),
  strategy: z.enum(STRATEGIES),
  baitDoor: z.enum(BAIT_DOORS),
  intent: z.string().min(1).max(INTENT_MAX),
});
export type SessionDirective = z.infer<typeof SessionDirectiveSchema>;

/** 엔진 → LLM: 실존 패턴 후보. 통계 수치까지 제공해 LLM은 "선택 + 패러프레이즈"만 한다. */
export interface PatternCandidate {
  id: PatternId;
  /** 사람이 읽는 형태의 통계 요약 (엔진 템플릿 산출) — LLM read의 원문 재료 */
  evidence: string;
  /** 해당 예측기의 현재 앙상블 성적 (0~1) */
  score: number;
}

/** 읽기 세션 요청 페이로드 (프록시 mode: 'session') */
export interface SessionInput {
  sessionNo: 1 | 2;
  roundNo: number;
  choices: Door[];
  caughtHistory: boolean[];
  bank: number;
  unsettled: number;
  streak: number;
  target: number;
  settleCount: number;
  /** 욕심 지표: 스트릭이 3 이상인 상태로 라운드에 들어간 횟수 */
  greedRounds: number;
  candidates: PatternCandidate[];
  prevStrategy: Strategy;
  runCount: number;
}

/** 최종 리포트 요청 페이로드 (프록시 mode: 'report') */
export interface ReportInput {
  result: 'WIN' | 'LOSE';
  earlyEnd: 'WIN_CONFIRMED' | 'DEAD_END' | null;
  roundsPlayed: number;
  bank: number;
  target: number;
  caughtCount: number;
  bestStreak: number;
  settleCount: number;
  greedRounds: number;
  /** 잡힌 라운드들의 귀속 패턴 분포 — "무엇에 읽혔나" */
  caughtByPattern: Partial<Record<PatternId, number>>;
  /** 약속 창에서의 성적 — 역이용 능력 지표 */
  windowRounds: number;
  windowPasses: number;
  runCount: number;
}

// API structured output용 (프록시에서 사용). Anthropic structured outputs는 maxLength를 지원하지
// 않아 zod와의 완전한 파리티는 불가능하다 — 길이 초과는 validator가 절단으로 처리(폴백 아님).
export const DIRECTIVE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    readPatternId: { type: 'string', enum: [...PATTERN_IDS] },
    read: { type: 'string' },
    taunt: { type: 'string' },
    strategy: { type: 'string', enum: [...STRATEGIES] },
    baitDoor: { type: 'string', enum: [...BAIT_DOORS] },
    intent: { type: 'string' },
  },
  required: ['readPatternId', 'read', 'taunt', 'strategy', 'baitDoor', 'intent'],
  additionalProperties: false,
} as const;
