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

/**
 * 예산 상한 집행 — 초과분을 거부가 아니라 **축소**로 처리한다. `fillToBudgetFloor`의 거울.
 *
 * **왜 거부가 아니라 축소인가**: 초과를 거부하면 폴백 뱅크로 떨어지는데, 뱅크 대사는 습관을 지목하지
 * 않는 고정 문자열("워밍업은 끝났다")이다. 심사자가 만나는 것이 '나를 읽는 디렉터'가 아니라 '대사 읽는
 * NPC'가 된다 — 이 게임의 존재 이유가 사라지는 지점이다. 축소하면 예산 상한은 그대로 지켜지면서
 * LLM이 쓴 taunt·intent·변주·강화·봉인이 전부 살아남는다. 안전성은 동일하고 디렉터의 존재감만 커진다.
 *
 * **왜 지금 필요해졌나**: 2026-08-07에 프롬프트를 "예산을 거의 다 써라(하한 80%·상한 100%)"로 바꿨다.
 * 하한 미달을 막으려던 변경인데, LLM을 천장 쪽으로 밀어놓고 천장을 넘으면 버리는 구조가 되어
 * 폴백 확률을 오히려 올렸다. 하한만 고치고 상한을 그대로 둔 것이 실수였다.
 *
 * ① 라운드로빈으로 1기씩 덜어 원래 구성 비율을 유지한다(항목당 최소 1기).
 * ② 그래도 넘으면 단가가 가장 비싼 항목부터 통째로 뺀다(최소 1항목은 남긴다) — 개체 수가 위협을
 *    만들므로 비싼 소수보다 싼 다수를 남기는 쪽이 디렉터의 의도에 가깝다.
 */
export function trimToBudgetCap(composition: Composition[], wave: number, buff: BuffCard): Composition[] {
  const cap = budgetFor(wave) - buffCostOf(buff, wave);
  const unitCostOf = (c: Composition) => ENEMY_COST[c.type] * (c.elite ? ELITE_MULT : 1);
  let spent = composition.reduce((s, c) => s + costOf(c), 0);
  if (spent <= cap) return composition;

  const trimmed = composition.map((c) => ({ ...c }));

  for (;;) {
    let removed = false;
    for (const c of trimmed) {
      if (spent <= cap) break;
      if (c.count <= 1) continue;
      c.count--;
      spent -= unitCostOf(c);
      removed = true;
    }
    if (spent <= cap || !removed) break;
  }

  while (spent > cap && trimmed.length > 1) {
    let worst = 0;
    for (let i = 1; i < trimmed.length; i++) {
      if (unitCostOf(trimmed[i]) > unitCostOf(trimmed[worst])) worst = i;
    }
    spent -= costOf(trimmed[worst]);
    trimmed.splice(worst, 1);
  }

  return trimmed;
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

  const mutation: Mutation = d.mutation !== 'NONE' && d.mutation === prevMutation ? 'NONE' : d.mutation;
  const buff: BuffCard = d.buff !== 'NONE' && d.buff === prevBuff ? 'NONE' : d.buff;
  const deny: DenyTarget = d.deny !== 'NONE' && d.deny === prevDeny ? 'NONE' : d.deny;

  // 예산 집행은 buff 강제 교체 **뒤에** 한다 — 교체로 buff가 NONE이 되면 그 비용(예산 25%)이 풀려
  // 가용 여유가 달라진다. 상한 초과는 축소, 하한 미달은 증원 — 양쪽 다 엔진이 결정론으로 집행하고,
  // 어느 쪽도 폴백으로 떨어뜨리지 않는다(LLM이 쓴 taunt를 잃지 않기 위해).
  const composition = fillToBudgetFloor(trimToBudgetCap(d.composition, wave, buff), wave, buff);

  // 방어적 확인 — 축소로도 상한을 못 맞추는 구성은 이론적으로 없지만(최소 구성 1항목 1기 = 최대 6점,
  // 최소 예산 12), 계약이 바뀌어 전제가 깨지면 조용히 상한을 넘기느니 폴백이 낫다.
  const total = composition.reduce((s, c) => s + costOf(c), 0) + buffCostOf(buff, wave);
  if (total > budgetFor(wave)) return null;

  return { ...d, composition, mutation, buff, deny };
}
