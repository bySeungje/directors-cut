import { z } from 'zod';

export const ENEMY_TYPES = ['chaser', 'shooter', 'splitter'] as const;
export const SPAWN_PATTERNS = ['N', 'S', 'E', 'W', 'RING', 'PINCER', 'BEHIND'] as const;
export const MUTATIONS = ['NONE', 'LAVA_LEFT', 'LAVA_RIGHT', 'LAVA_HOTSPOT', 'FOG', 'SPEED_SURGE', 'SHRINK_ARENA', 'SPAWN_STORM'] as const;
export const BUFF_CARDS = ['NONE', 'TOUGH', 'SWIFT', 'RELENTLESS', 'RAPID_FIRE', 'MARKSMAN', 'VOLATILE', 'INTERCEPT', 'ENCIRCLE', 'EVASIVE'] as const;
/** 업그레이드 봉인 대상. `src/game/upgrades.ts`의 UPGRADE_IDS와 항목·순서가 일치해야 한다
 *  — 별도 파일이라 타입체커가 보장하지 못하므로 tests/upgrades.test.ts가 드리프트를 막는다. */
export const DENY_TARGETS = [
  'NONE', 'DAMAGE_UP', 'FIRE_RATE_UP', 'MOVE_SPEED_UP', 'HP_PLUS',
  'PIERCE', 'MULTI_SHOT', 'BULLET_SPEED_UP', 'DASH_CD_DOWN',
] as const;

/** 플레이어 습관 어휘. `WaveLog`를 타고 프롬프트에 실리므로 계약이 소유한다 —
 *  단 `DirectiveSchema`/`DIRECTIVE_JSON_SCHEMA`(LLM 출력)에는 들어가지 않으므로
 *  프록시 수동 사본과 무관하다. 판정 규칙은 `src/game/habits.ts`. */
export const HABIT_IDS = ['ANCHOR', 'CORNER', 'DASH'] as const;
export type HabitId = (typeof HABIT_IDS)[number];

export type EnemyType = (typeof ENEMY_TYPES)[number];
export type SpawnPattern = (typeof SPAWN_PATTERNS)[number];
export type Mutation = (typeof MUTATIONS)[number];
export type BuffCard = (typeof BUFF_CARDS)[number];
export type DenyTarget = (typeof DENY_TARGETS)[number];

export const CompositionSchema = z.object({
  type: z.enum(ENEMY_TYPES),
  count: z.number().int().min(1).max(30),
  spawn: z.enum(SPAWN_PATTERNS),
  elite: z.boolean(),
});

export const DirectiveSchema = z.object({
  composition: z.array(CompositionSchema).min(1).max(4),
  mutation: z.enum(MUTATIONS),
  buff: z.enum(BUFF_CARDS),
  deny: z.enum(DENY_TARGETS),
  taunt: z.string().min(1).max(60),
  intent: z.string().min(1).max(100),
});

export type Composition = z.infer<typeof CompositionSchema>;
export type Directive = z.infer<typeof DirectiveSchema>;

export interface WaveLog {
  wave: number;
  clearTimeSec: number;
  hpLost: number;
  damageSources: Partial<Record<EnemyType, number>>;
  movement: { quadrantTime: { NW: number; NE: number; SW: number; SE: number }; wallHugRatio: number; dashCount: number; hotspotConcentration: number };
  combat: { kills: Partial<Record<EnemyType, number>>; accuracy: number; clusterRatio: number };
  upgrades: string[];
  prevMutations: Mutation[];
  /** 이 웨이브에서 관측된 지배적 습관. **선택 필드다** — `client.ts`의 `WARMUP_LOG`와 테스트 픽스처가
   *  `WaveLog` 객체 리터럴을 직접 만들고 있어 필수로 두면 타입체크가 깨진다.
   *  채우는 곳은 `ArenaScene.snapshotCurrentWaveLog`이지 `collector.finish()`가 아니다 —
   *  finish() 반환 뒤에 hpLost가 보정되므로 수집기는 최종 로그를 보지 못한다. */
  dominantHabit?: HabitId | null;
}

export const ENEMY_COST: Record<EnemyType, number> = { chaser: 1, shooter: 2, splitter: 2 };
export const ELITE_MULT = 3;
/** 강화 카드 비용 = 해당 웨이브 예산의 25%(반올림). NONE은 0. (스펙 §3.4.1) */
export const BUFF_COST_RATIO = 0.25;

// API structured output용 (프록시에서 사용). Anthropic structured outputs는 minimum/maximum/maxLength/minItems를
// 지원하지 않아 위 zod 스키마와의 완전한 파리티는 원리적으로 불가능하다 — 범위를 벗어난 응답은 validateDirective가
// 걸러 폴백으로 전환한다(설계된 이중 검증, src/director/validator.ts).
export const DIRECTIVE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    composition: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: [...ENEMY_TYPES] },
          count: { type: 'integer' },
          spawn: { type: 'string', enum: [...SPAWN_PATTERNS] },
          elite: { type: 'boolean' },
        },
        required: ['type', 'count', 'spawn', 'elite'],
        additionalProperties: false,
      },
    },
    mutation: { type: 'string', enum: [...MUTATIONS] },
    buff: { type: 'string', enum: [...BUFF_CARDS] },
    deny: { type: 'string', enum: [...DENY_TARGETS] },
    taunt: { type: 'string' },
    intent: { type: 'string' },
  },
  required: ['composition', 'mutation', 'buff', 'deny', 'taunt', 'intent'],
  additionalProperties: false,
} as const;
