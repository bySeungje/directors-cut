import { Directive, DirectiveSchema, Mutation, Composition, ENEMY_COST, ELITE_MULT } from '../contracts/directive';

export function budgetFor(wave: number): number {
  return 8 + wave * 4 + Math.max(0, wave - 5) * 12;
}

export function costOf(c: Composition): number {
  return c.count * ENEMY_COST[c.type] * (c.elite ? ELITE_MULT : 1);
}

export function validateDirective(raw: unknown, wave: number, prevMutation: Mutation): Directive | null {
  const parsed = DirectiveSchema.safeParse(raw);
  if (!parsed.success) return null;
  const d = parsed.data;
  const total = d.composition.reduce((s, c) => s + costOf(c), 0);
  if (total > budgetFor(wave)) return null;
  if (d.mutation !== 'NONE' && d.mutation === prevMutation) return { ...d, mutation: 'NONE' };
  return d;
}
