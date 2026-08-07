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

/** 예산 하한 비율. 이 아래로 쓴 디렉티브는 엔진이 물량을 증원해 채운다. */
export const BUDGET_FLOOR_RATIO = 0.8;

/** 스키마상 composition 항목당 count 상한·배열 길이 상한(CompositionSchema·DirectiveSchema와 일치해야 한다). */
const COUNT_MAX = 30;
const COMPOSITION_MAX = 4;

/**
 * 예산 하한 집행 — 디렉터가 예산을 적게 쓰면 엔진이 개체 수를 비례 증원한다.
 *
 * **왜 거부가 아니라 증원인가**: 하한 미달을 거부하면 폴백 뱅크로 떨어지는데, 그러면 LLM이 쓴
 * taunt(플레이어의 습관을 지목하는 문장)를 함께 잃는다. 그 문장이 이 게임의 존재 이유다.
 * 어휘(적 종류·스폰·강화·대사)는 LLM이 정하고 밀도는 엔진이 정한다 — 상한을 엔진이 강제하는 것과
 * 같은 원리이며 §3.4 권한 경계가 그대로 유지된다.
 *
 * **왜 필요한가**: 검증기에 상한만 있어서 예산 90짜리 웨이브에 20을 써도 통과했다. 프록시 프롬프트도
 * '예산 이하로'·'물량으로 압살하지 마라'로 과소 소비를 유도했고, 실측 결론이 '위협은 동시 접촉 개체
 * 수가 만든다'이므로 그 지시가 유일하게 작동하는 위협 레버를 막고 있었다. 8/6 밸런스 실측은 예산을
 * 꽉 채우는 폴백 뱅크 경로에서만 나왔고 LLM 경로에는 닿은 적이 없다.
 *
 * 라운드로빈으로 1기씩 더해 원래 구성 비율을 유지하고, 스키마 상한(count 30)과 예산 상한을 넘지 않는다.
 */
export function fillToBudgetFloor(composition: Composition[], wave: number, buff: BuffCard): Composition[] {
  const cap = budgetFor(wave);
  const floor = Math.floor(cap * BUDGET_FLOOR_RATIO);
  let spent = composition.reduce((s, c) => s + costOf(c), 0) + buffCostOf(buff, wave);
  if (spent >= floor) return composition;

  const unitCostOf = (c: Composition) => ENEMY_COST[c.type] * (c.elite ? ELITE_MULT : 1);
  const filled = composition.map((c) => ({ ...c }));

  for (;;) {
    let added = false;
    for (const c of filled) {
      if (spent >= floor) break;
      if (c.count >= COUNT_MAX) continue;
      const unit = unitCostOf(c);
      if (spent + unit > cap) continue;
      c.count++;
      spent += unit;
      added = true;
    }
    if (spent >= floor) return filled;
    if (added) continue;

    // 전 항목이 count 상한(30)에 걸려 더 못 키운다. 항목이 하나뿐인 디렉티브는 30기가 최대라
    // 후반 웨이브 하한(웨이브 7 = 72)에 원리적으로 닿지 못하므로, 스키마 상한(4) 안에서 항목을
    // 복제해 계속 채운다 — 폴백 뱅크의 웨이브 7이 30+30+12로 항목을 쪼개 쓰는 것과 같은 형태다.
    // 개체 수가 위협을 만들므로 단가가 가장 싼 항목을 복제해 같은 예산에서 몸통을 최대화한다.
    if (filled.length >= COMPOSITION_MAX) return filled;
    const seed = filled.reduce((a, b) => (unitCostOf(b) < unitCostOf(a) ? b : a));
    const unit = unitCostOf(seed);
    if (spent + unit > cap) return filled;
    filled.push({ ...seed, count: 1 });
    spent += unit;
  }
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
  // 하한 집행은 buff 강제 교체 뒤에 한다 — 교체로 buff가 NONE이 되면 그 비용(예산 25%)이 풀려
  // 증원 가능한 여유가 달라지기 때문이다.
  const composition = fillToBudgetFloor(d.composition, wave, buff);
  return { ...d, composition, mutation, buff, deny };
}
