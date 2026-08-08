import { describe, it, expect } from 'vitest';
import {
  validateDirective, budgetFor, costOf, buffCostOf,
  fillToBudgetFloor, trimToBudgetCap, BUDGET_FLOOR_RATIO,
} from '../src/director/validator';
import { DirectiveSchema } from '../src/contracts/directive';

const ok = {
  composition: [{ type: 'chaser', count: 8, spawn: 'N', elite: false }],
  mutation: 'FOG', taunt: '벽에 붙는 습관, 봤다.', intent: '벽면 회피 차단', buff: 'NONE', deny: 'NONE',
};

describe('validateDirective', () => {
  it('정상 디렉티브 통과', () => {
    expect(validateDirective(ok, 3, 'NONE', 'NONE', 'NONE')).not.toBeNull();
  });
  it('enum 밖 값 거부', () => {
    expect(validateDirective({ ...ok, mutation: 'EARTHQUAKE' }, 3, 'NONE', 'NONE', 'NONE')).toBeNull();
  });
  it('taunt 60자 초과 거부', () => {
    expect(validateDirective({ ...ok, taunt: '가'.repeat(61) }, 3, 'NONE', 'NONE', 'NONE')).toBeNull();
  });
  // 2026-08-08 변경: 예산 초과는 거부가 아니라 축소다. 거부하면 폴백 뱅크로 떨어지는데 뱅크 대사는
  // 습관을 지목하지 않는 고정 문자열이라, 심사자가 만나는 것이 '나를 읽는 디렉터'가 아니게 된다.
  it('예산 초과는 거부가 아니라 축소된다 — LLM이 쓴 대사를 잃지 않기 위해', () => {
    const over = { ...ok, composition: [{ type: 'splitter', count: 30, spawn: 'RING', elite: true }] };
    const v = validateDirective(over, 3, 'NONE', 'NONE', 'NONE');
    expect(v).not.toBeNull();
    expect(v!.taunt).toBe(ok.taunt);
    expect(v!.composition.reduce((s, c) => s + costOf(c), 0)).toBeLessThanOrEqual(budgetFor(3));
  });
  it('동일 mutation 2연속이면 mutation을 NONE으로 강제 교체(거부 아님)', () => {
    const v = validateDirective(ok, 3, 'FOG', 'NONE', 'NONE');
    expect(v).not.toBeNull();
    expect(v!.mutation).toBe('NONE');
  });
  it('count 0 이하·비정수 거부', () => {
    expect(validateDirective({ ...ok, composition: [{ type: 'chaser', count: 0, spawn: 'N', elite: false }] }, 3, 'NONE', 'NONE', 'NONE')).toBeNull();
  });
  it('예산 미달 디렉티브는 거부가 아니라 증원돼서 통과한다 — taunt를 보존하기 위해', () => {
    const thin = { ...ok, composition: [{ type: 'chaser', count: 1, spawn: 'N', elite: false }] };
    const v = validateDirective(thin, 7, 'NONE', 'NONE', 'NONE');
    expect(v).not.toBeNull();
    expect(v!.taunt).toBe(ok.taunt); // LLM이 쓴 문장이 살아남는다(폴백으로 안 떨어진다)
    expect(v!.composition.reduce((s, c) => s + costOf(c), 0)).toBeGreaterThanOrEqual(
      Math.floor(budgetFor(7) * BUDGET_FLOOR_RATIO),
    );
  });
});

// 하한이 없어 예산 90짜리 웨이브에 20을 써도 통과하던 결함(2026-08-07 발견). 8/6 밸런스 실측은
// 예산을 꽉 채우는 폴백 뱅크 경로에서만 나왔고 LLM 경로에는 닿은 적이 없었다.
// 천장을 거부로 두면 LLM을 천장 쪽으로 미는 프롬프트(2026-08-07 변경)와 맞물려 폴백 확률이 오른다.
// 폴백은 습관을 지목하지 못하므로, 심사자가 가장 자주 만나는 디렉터가 가장 무성의한 버전이 된다.
describe('예산 상한 (trimToBudgetCap)', () => {
  const total = (c: ReturnType<typeof trimToBudgetCap>) => c.reduce((s, x) => s + costOf(x), 0);

  it('상한 이하면 구성을 그대로 둔다', () => {
    const fit = [{ type: 'chaser' as const, count: 5, spawn: 'N' as const, elite: false }];
    expect(trimToBudgetCap(fit, 5, 'NONE')).toEqual(fit);
  });

  it('모든 웨이브에서 최대 구성을 상한 안으로 줄인다', () => {
    const huge = [
      { type: 'splitter' as const, count: 30, spawn: 'RING' as const, elite: true },
      { type: 'shooter' as const, count: 30, spawn: 'N' as const, elite: true },
      { type: 'chaser' as const, count: 30, spawn: 'S' as const, elite: true },
      { type: 'chaser' as const, count: 30, spawn: 'W' as const, elite: false },
    ];
    for (let w = 1; w <= 7; w++) expect(total(trimToBudgetCap(huge, w, 'NONE'))).toBeLessThanOrEqual(budgetFor(w));
  });

  it('강화 카드 비용만큼 더 줄인다 — 카드를 쓰면 물량이 준다(§3.4.1-2)', () => {
    // 웨이브 7 예산 90. 두 항목 합 120점이라 카드 유무 양쪽에서 실제로 축소가 일어난다.
    const huge = [
      { type: 'chaser' as const, count: 30, spawn: 'N' as const, elite: false },
      { type: 'chaser' as const, count: 30, spawn: 'S' as const, elite: true },
    ];
    const withBuff = total(trimToBudgetCap(huge, 7, 'TOUGH'));
    expect(withBuff + buffCostOf('TOUGH', 7)).toBeLessThanOrEqual(budgetFor(7));
    expect(withBuff).toBeLessThan(total(trimToBudgetCap(huge, 7, 'NONE')));
  });

  it('항목을 최소 1개는 남기고 각 항목의 count도 최소 1이다(스키마 위반 방지)', () => {
    const huge = [
      { type: 'splitter' as const, count: 30, spawn: 'RING' as const, elite: true },
      { type: 'shooter' as const, count: 30, spawn: 'N' as const, elite: true },
    ];
    const out = trimToBudgetCap(huge, 1, 'TOUGH');
    expect(out.length).toBeGreaterThanOrEqual(1);
    for (const c of out) expect(c.count).toBeGreaterThanOrEqual(1);
  });

  it('축소 후에도 계약 스키마를 통과한다', () => {
    const over = { ...ok, composition: [{ type: 'splitter', count: 30, spawn: 'RING', elite: true }, { type: 'chaser', count: 30, spawn: 'N', elite: true }] };
    for (let w = 1; w <= 7; w++) {
      const v = validateDirective(over, w, 'NONE', 'NONE', 'NONE');
      expect(v).not.toBeNull();
      expect(DirectiveSchema.safeParse(v).success).toBe(true);
    }
  });

  it('어떤 초과 구성도 폴백으로 떨어뜨리지 않는다 — 대사가 살아남아야 한다', () => {
    const over = { ...ok, taunt: '구석만 파는군.', composition: [{ type: 'splitter', count: 30, spawn: 'RING', elite: true }] };
    for (let w = 1; w <= 7; w++) {
      expect(validateDirective(over, w, 'NONE', 'NONE', 'NONE')?.taunt).toBe('구석만 파는군.');
    }
  });
});

describe('예산 하한 (fillToBudgetFloor)', () => {
  const floorOf = (w: number) => Math.floor(budgetFor(w) * BUDGET_FLOOR_RATIO);
  const total = (c: ReturnType<typeof fillToBudgetFloor>) => c.reduce((s, x) => s + costOf(x), 0);

  it('하한 이상이면 구성을 그대로 둔다', () => {
    const full = [{ type: 'chaser' as const, count: 30, spawn: 'N' as const, elite: false }];
    expect(fillToBudgetFloor(full, 5, 'NONE')).toEqual(full);
  });

  it('모든 웨이브에서 하한을 채우고 상한을 넘지 않는다', () => {
    for (let w = 1; w <= 7; w++) {
      const thin = [{ type: 'chaser' as const, count: 1, spawn: 'RING' as const, elite: false }];
      const t = total(fillToBudgetFloor(thin, w, 'NONE'));
      expect(t).toBeGreaterThanOrEqual(floorOf(w));
      expect(t).toBeLessThanOrEqual(budgetFor(w));
    }
  });

  it('강화 카드 비용을 합산해 판정한다 — 카드가 있으면 그만큼 덜 증원한다', () => {
    const thin = [{ type: 'chaser' as const, count: 1, spawn: 'N' as const, elite: false }];
    const withBuff = total(fillToBudgetFloor(thin, 7, 'TOUGH'));
    const without = total(fillToBudgetFloor(thin, 7, 'NONE'));
    expect(withBuff).toBeLessThan(without);
    expect(withBuff + buffCostOf('TOUGH', 7)).toBeGreaterThanOrEqual(floorOf(7));
    expect(withBuff + buffCostOf('TOUGH', 7)).toBeLessThanOrEqual(budgetFor(7));
  });

  it('항목당 count 상한 30을 넘기지 않는다(스키마 위반 방지)', () => {
    const thin = [{ type: 'chaser' as const, count: 1, spawn: 'N' as const, elite: false }];
    for (const c of fillToBudgetFloor(thin, 7, 'NONE')) expect(c.count).toBeLessThanOrEqual(30);
  });

  it('항목이 상한에 걸리면 항목을 복제해 채운다 — 단일 항목 30기로는 후반 하한에 못 닿기 때문', () => {
    // 웨이브 7 하한 72. 항목 하나로는 chaser 30기(30점)가 최대라 원리적으로 못 닿는다.
    const capped = [{ type: 'chaser' as const, count: 30, spawn: 'N' as const, elite: false }];
    const out = fillToBudgetFloor(capped, 7, 'NONE');
    expect(out.length).toBeGreaterThan(1);
    expect(total(out)).toBeGreaterThanOrEqual(floorOf(7));
  });

  it('composition 배열 상한 4를 넘기지 않는다(스키마 위반 방지)', () => {
    // 입력은 항상 상한 내여야 한다 — validateDirective가 천장을 먼저 검사하므로 초과 구성이
    // 이 함수에 도달할 일은 없다. 최소 구성(1기)에서 시작해 각 웨이브 하한까지 채우게 한다.
    const thin = [{ type: 'chaser' as const, count: 1, spawn: 'N' as const, elite: false }];
    for (let w = 1; w <= 7; w++) {
      const out = fillToBudgetFloor(thin, w, 'NONE');
      expect(out.length).toBeLessThanOrEqual(4);
      expect(total(out)).toBeLessThanOrEqual(budgetFor(w));
      expect(total(out)).toBeGreaterThanOrEqual(floorOf(w));
    }
  });

  it('이미 상한을 넘는 구성은 증원하지 않는다 — 천장은 trimToBudgetCap의 몫', () => {
    const over = [{ type: 'chaser' as const, count: 30, spawn: 'N' as const, elite: false }];
    expect(fillToBudgetFloor(over, 1, 'NONE')).toEqual(over);
    // validateDirective는 축소 → 증원 순으로 집행하므로 거부하지 않고 상한 안으로 들여놓는다.
    const v = validateDirective({ ...ok, composition: over }, 1, 'NONE', 'NONE', 'NONE');
    expect(v).not.toBeNull();
    expect(v!.composition.reduce((s, c) => s + costOf(c), 0)).toBeLessThanOrEqual(budgetFor(1));
  });

  it('증원 결과가 스키마를 다시 통과한다 — 엔진이 만든 구성이 계약을 어기지 않아야 한다', () => {
    const thin = { ...ok, composition: [{ type: 'chaser', count: 1, spawn: 'N', elite: false }] };
    const v = validateDirective(thin, 7, 'NONE', 'NONE', 'NONE')!;
    expect(DirectiveSchema.safeParse(v).success).toBe(true);
  });

  it('원래 구성 비율을 유지한다 — 한 종류만 몰아주지 않는다', () => {
    const mixed = [
      { type: 'chaser' as const, count: 2, spawn: 'N' as const, elite: false },
      { type: 'shooter' as const, count: 1, spawn: 'S' as const, elite: false },
    ];
    const out = fillToBudgetFloor(mixed, 6, 'NONE');
    expect(out[0].count).toBeGreaterThan(2);
    expect(out[1].count).toBeGreaterThan(1);
  });
});

describe('budget', () => {
  it('예산은 웨이브에 따라 단조 증가', () => {
    for (let w = 1; w < 7; w++) expect(budgetFor(w + 1)).toBeGreaterThan(budgetFor(w));
  });
  it('비용: chaser 1, shooter 2, splitter 2, elite ×3', () => {
    expect(costOf({ type: 'chaser', count: 4, spawn: 'N', elite: false })).toBe(4);
    expect(costOf({ type: 'shooter', count: 2, spawn: 'N', elite: true })).toBe(12);
  });
});

describe('강화 카드', () => {
  it('buff 필드가 없으면 거부', () => {
    const { buff, ...noBuff } = { ...ok };
    expect(validateDirective(noBuff, 3, 'NONE', 'NONE', 'NONE')).toBeNull();
  });
  it('enum 밖 카드 거부', () => {
    expect(validateDirective({ ...ok, buff: 'GODMODE' }, 3, 'NONE', 'NONE', 'NONE')).toBeNull();
  });
  it('NONE 비용은 0, 그 외는 예산의 25% 반올림', () => {
    expect(buffCostOf('NONE', 3)).toBe(0);
    expect(buffCostOf('TOUGH', 3)).toBe(Math.round(budgetFor(3) * 0.25));
    expect(buffCostOf('SWIFT', 7)).toBe(Math.round(budgetFor(7) * 0.25));
  });
  it('buff 비용이 예산에 합산돼 초과분이 축소된다', () => {
    // 웨이브 3 예산 20, buff 비용 5 → composition 상한은 15
    const near = { ...ok, composition: [{ type: 'chaser', count: 16, spawn: 'N', elite: false }], buff: 'TOUGH' };
    const v = validateDirective(near, 3, 'NONE', 'NONE', 'NONE');
    expect(v).not.toBeNull();
    expect(v!.composition.reduce((s, c) => s + costOf(c), 0)).toBeLessThanOrEqual(budgetFor(3) - buffCostOf('TOUGH', 3));
    const fits = { ...ok, composition: [{ type: 'chaser', count: 15, spawn: 'N', elite: false }], buff: 'TOUGH' };
    expect(validateDirective(fits, 3, 'NONE', 'NONE', 'NONE')!.composition[0].count).toBe(15);
  });
  it('buff 없이는 예산 전액을 composition에 쓸 수 있다', () => {
    const full = { ...ok, composition: [{ type: 'chaser', count: 20, spawn: 'N', elite: false }], buff: 'NONE' };
    expect(validateDirective(full, 3, 'NONE', 'NONE', 'NONE')).not.toBeNull();
  });
  it('직전과 같은 카드는 NONE으로 강제 교체(거부 아님)', () => {
    const v = validateDirective({ ...ok, buff: 'TOUGH' }, 3, 'NONE', 'TOUGH', 'NONE');
    expect(v).not.toBeNull();
    expect(v!.buff).toBe('NONE');
  });
  it('직전이 NONE이면 NONE을 다시 써도 통과', () => {
    const v = validateDirective({ ...ok, buff: 'NONE' }, 3, 'NONE', 'NONE', 'NONE');
    expect(v!.buff).toBe('NONE');
  });
  it('직전과 다른 카드는 유지', () => {
    const v = validateDirective({ ...ok, buff: 'SWIFT' }, 3, 'NONE', 'TOUGH', 'NONE');
    expect(v!.buff).toBe('SWIFT');
  });
});

describe('업그레이드 봉인 검증', () => {
  it('deny 필드가 없으면 거부', () => {
    const { deny, ...noDeny } = { ...ok };
    expect(validateDirective(noDeny, 3, 'NONE', 'NONE', 'NONE')).toBeNull();
  });
  it('enum 밖 값 거부', () => {
    expect(validateDirective({ ...ok, deny: 'GOD_MODE' }, 3, 'NONE', 'NONE', 'NONE')).toBeNull();
  });
  it('직전과 같은 봉인은 NONE으로 강제 교체', () => {
    const v = validateDirective({ ...ok, deny: 'PIERCE' }, 3, 'NONE', 'NONE', 'PIERCE');
    expect(v).not.toBeNull();
    expect(v!.deny).toBe('NONE');
  });
  it('직전과 다른 봉인은 유지', () => {
    const v = validateDirective({ ...ok, deny: 'MULTI_SHOT' }, 3, 'NONE', 'NONE', 'PIERCE');
    expect(v!.deny).toBe('MULTI_SHOT');
  });
  it('deny는 예산을 소모하지 않는다 — 예산 전액을 composition에 쓸 수 있다', () => {
    const full = { ...ok, composition: [{ type: 'chaser', count: 20, spawn: 'N', elite: false }], buff: 'NONE', deny: 'DAMAGE_UP' };
    expect(validateDirective(full, 3, 'NONE', 'NONE', 'NONE')).not.toBeNull();
  });
});
