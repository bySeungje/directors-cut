import {
  Directive, DirectiveSchema, Mutation, Composition, BuffCard, DenyTarget,
  ENEMY_COST, ELITE_MULT, BUFF_COST_RATIO,
} from '../contracts/directive';

/** 웨이브별 스폰 예산: 12/16/20/24/34/56/90. 후반이 제곱으로 가속하는 이유는 플레이어 성장이
 *  곱셈이기 때문이다 — 업그레이드 6회면 초당 피해가 12배가 된다(스펙 §3.4·§3.4.3).
 *  최종 90은 실측 임계점(chaser 80: 정지 시 체력 26 손실, 이동 시 1) 위에 있다. */
export function budgetFor(wave: number): number {
  return 8 + wave * 4 + Math.max(0, wave - 4) ** 2 * 6;
}

export function costOf(c: Composition): number {
  return c.count * ENEMY_COST[c.type] * (c.elite ? ELITE_MULT : 1);
}

/** 강화 카드 비용 — 해당 웨이브 예산의 25%(반올림). NONE은 0. */
export function buffCostOf(card: BuffCard, wave: number): number {
  return card === 'NONE' ? 0 : Math.round(budgetFor(wave) * BUFF_COST_RATIO);
}

export function validateDirective(
  raw: unknown,
  wave: number,
  prevMutation: Mutation,
  prevBuff: BuffCard,
  prevDeny: DenyTarget,
): Directive | null {
  const parsed = DirectiveSchema.safeParse(raw);
  if (!parsed.success) return null;
  const d = parsed.data;
  const total = d.composition.reduce((s, c) => s + costOf(c), 0) + buffCostOf(d.buff, wave);
  if (total > budgetFor(wave)) return null;

  const mutation: Mutation = d.mutation !== 'NONE' && d.mutation === prevMutation ? 'NONE' : d.mutation;
  const buff: BuffCard = d.buff !== 'NONE' && d.buff === prevBuff ? 'NONE' : d.buff;
  const deny: DenyTarget = d.deny !== 'NONE' && d.deny === prevDeny ? 'NONE' : d.deny;
  return { ...d, mutation, buff, deny };
}
