import { z } from 'zod';

export const ENEMY_TYPES = ['chaser', 'shooter', 'splitter'] as const;
export const SPAWN_PATTERNS = ['N', 'S', 'E', 'W', 'RING', 'PINCER', 'BEHIND'] as const;
export const MUTATIONS = ['NONE', 'LAVA_LEFT', 'LAVA_RIGHT', 'FOG', 'SPEED_SURGE', 'SHRINK_ARENA', 'SPAWN_STORM'] as const;

export type EnemyType = (typeof ENEMY_TYPES)[number];
export type SpawnPattern = (typeof SPAWN_PATTERNS)[number];
export type Mutation = (typeof MUTATIONS)[number];

export const CompositionSchema = z.object({
  type: z.enum(ENEMY_TYPES),
  count: z.number().int().min(1).max(30),
  spawn: z.enum(SPAWN_PATTERNS),
  elite: z.boolean(),
});

export const DirectiveSchema = z.object({
  composition: z.array(CompositionSchema).min(1).max(4),
  mutation: z.enum(MUTATIONS),
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
  movement: { quadrantTime: { NW: number; NE: number; SW: number; SE: number }; wallHugRatio: number; dashCount: number };
  combat: { kills: Partial<Record<EnemyType, number>>; accuracy: number };
  upgrades: string[];
  prevMutations: Mutation[];
}

export const ENEMY_COST: Record<EnemyType, number> = { chaser: 1, shooter: 2, splitter: 2 };
export const ELITE_MULT = 3;

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
    taunt: { type: 'string' },
    intent: { type: 'string' },
  },
  required: ['composition', 'mutation', 'taunt', 'intent'],
  additionalProperties: false,
} as const;
