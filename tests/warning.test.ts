import { describe, it, expect } from 'vitest';
import {
  WARN_TEXT, CARDINALS, directionFromHotspot, habitHasDirection,
  sanitizeDirectiveForWarning, erasesCausality, warnKindFor, warnLine, directionAheadOfOrbit,
  type WarnDirection,
} from '../src/game/warning';
import { MUTATIONS, BUFF_CARDS, SPAWN_PATTERNS, type Directive } from '../src/contracts/directive';

const base: Directive = {
  composition: [
    { type: 'chaser', count: 6, spawn: 'RING', elite: false },
    { type: 'shooter', count: 2, spawn: 'BEHIND', elite: false },
  ],
  mutation: 'NONE',
  buff: 'NONE',
  deny: 'NONE',
  taunt: 't',
  intent: 'i',
};

describe('예고 방향 — 결정론', () => {
  it('핫스팟이 치우친 축의 방향을 고른다', () => {
    expect(directionFromHotspot(100, 320, 960, 640)).toBe('W');
    expect(directionFromHotspot(860, 320, 960, 640)).toBe('E');
    expect(directionFromHotspot(480, 60, 960, 640)).toBe('N');
    expect(directionFromHotspot(480, 600, 960, 640)).toBe('S');
  });

  it('같은 입력에 항상 같은 방향 — 무작위가 섞이면 예고와 스폰이 어긋난다', () => {
    const runs = new Set<WarnDirection>();
    for (let i = 0; i < 50; i++) runs.add(directionFromHotspot(120, 500, 960, 640));
    expect(runs.size).toBe(1);
  });

  it('정확히 중앙이어도 방향을 반환한다 (null 금지 — 예고가 사라지면 비트가 깨진다)', () => {
    expect(CARDINALS).toContain(directionFromHotspot(480, 320, 960, 640));
  });

  it('네 방향 전부 예고 문장을 갖는다', () => {
    for (const d of CARDINALS) expect(WARN_TEXT[d].length).toBeGreaterThan(0);
  });

  it('위치 습관만 방향을 갖는다 — 대시 습관은 예고 대상이 아니다', () => {
    expect(habitHasDirection('ANCHOR')).toBe(true);
    expect(habitHasDirection('CORNER')).toBe(true);
    expect(habitHasDirection('DASH')).toBe(false);
    expect(habitHasDirection(null)).toBe(false);
  });
});

describe('인과 보장 — 예고한 방향과 실제로 벌어지는 일이 일치한다', () => {
  it('모든 composition의 스폰이 예고 방향으로 고정된다 (RING/PINCER/BEHIND 포함)', () => {
    for (const dir of CARDINALS) {
      const out = sanitizeDirectiveForWarning(base, dir);
      expect(out.composition.every((c) => c.spawn === dir)).toBe(true);
    }
  });

  it('예고한 쪽을 덮어 인과를 지우는 변주는 차단된다', () => {
    // FOG는 depth 500으로 엔티티 위에 그려져 예고한 쪽의 마커와 적을 가린다.
    // SPAWN_STORM은 구성을 3분할해 4초 간격으로 뿌려 마커 선행이 첫 배치에만 걸린다.
    for (const m of ['FOG', 'SPAWN_STORM'] as const) {
      expect(sanitizeDirectiveForWarning({ ...base, mutation: m }, 'W').mutation).toBe('NONE');
      expect(erasesCausality(m, 'NONE')).toBe(true);
    }
  });

  it('방향 읽기를 지우는 강화 카드는 차단된다', () => {
    // ENCIRCLE은 약 5.6초 만에 적을 플레이어 주위 링으로 모아 "왼쪽에서 왔다"를 지운다.
    for (const b of ['ENCIRCLE', 'EVASIVE'] as const) {
      expect(sanitizeDirectiveForWarning({ ...base, buff: b }, 'E').buff).toBe('NONE');
      expect(erasesCausality('NONE', b)).toBe(true);
    }
  });

  it('인과를 지우지 않는 변주·카드는 그대로 살아남는다 — 예고가 게임을 밋밋하게 만들면 안 된다', () => {
    const kept = sanitizeDirectiveForWarning({ ...base, mutation: 'LAVA_LEFT', buff: 'TOUGH' }, 'N');
    expect(kept.mutation).toBe('LAVA_LEFT');
    expect(kept.buff).toBe('TOUGH');
  });

  it('예고가 없는 웨이브는 아무것도 건드리지 않는다', () => {
    const untouched = sanitizeDirectiveForWarning({ ...base, mutation: 'FOG', buff: 'ENCIRCLE' }, null);
    expect(untouched).toEqual({ ...base, mutation: 'FOG', buff: 'ENCIRCLE' });
  });

  it('변주 8종·카드 10종 전수 대조 — 어떤 조합에서도 스폰 방향은 예고와 일치한다', () => {
    // docs/_hub/nodes/C-mutation-judge-collision.md: "새 지표를 만들면 변주 8종 각각과 교차 검사한다".
    // 예고는 새 지표는 아니지만 같은 계열의 사고다 — 전수로 돌려 빠진 조합이 없음을 보인다.
    for (const m of MUTATIONS) {
      for (const b of BUFF_CARDS) {
        const out = sanitizeDirectiveForWarning({ ...base, mutation: m, buff: b }, 'S');
        expect(out.composition.every((c) => c.spawn === 'S')).toBe(true);
        expect(erasesCausality(out.mutation, out.buff)).toBe(false);
      }
    }
  });

  it('강제되는 스폰 값은 계약의 유효 enum이다', () => {
    for (const dir of CARDINALS) expect(SPAWN_PATTERNS).toContain(dir);
  });
});

describe('표적 대응 — 물량이 아니라 읽은 대로 갚는다', () => {
  it('습관마다 갚는 방식이 다르다', () => {
    expect(warnKindFor('ANCHOR')).toBe('CLOSE');
    expect(warnKindFor('CORNER')).toBe('CLOSE');
    expect(warnKindFor('ORBIT')).toBe('CUT');
    expect(warnKindFor('MICRO')).toBe('BURN');
    expect(warnKindFor('DASH')).toBe(null);   // 방향도 자리도 없는 습관 — 예고 없는 웨이브
    expect(warnKindFor(null)).toBe(null);
  });

  it('선회형은 머문 자리가 아니라 **도는 앞**을 막는다', () => {
    // 오른쪽(E)에 있고 시계 방향으로 돌면 다음은 아래(S)다. 머문 자리를 닫는 CLOSE와 결과가 다르다.
    expect(directionAheadOfOrbit(900, 320, 960, 640, +1)).toBe('S');
    expect(directionAheadOfOrbit(900, 320, 960, 640, -1)).toBe('N');
    expect(directionFromHotspot(900, 320, 960, 640)).toBe('E'); // 같은 위치, 다른 대응
  });

  it('미세 회피형은 방면이 아니라 선 자리를 태운다 — LAVA_HOTSPOT을 강제한다', () => {
    const out = sanitizeDirectiveForWarning({ ...base, mutation: 'NONE' }, 'W', 'BURN');
    expect(out.mutation).toBe('LAVA_HOTSPOT');
  });

  it('CLOSE·CUT는 변주를 강제하지 않는다 — 표적 대응은 습관별로 정확히 하나뿐이다', () => {
    expect(sanitizeDirectiveForWarning({ ...base, mutation: 'LAVA_LEFT' }, 'W', 'CLOSE').mutation).toBe('LAVA_LEFT');
    expect(sanitizeDirectiveForWarning({ ...base, mutation: 'LAVA_LEFT' }, 'W', 'CUT').mutation).toBe('LAVA_LEFT');
  });

  it('예고 문장이 성격마다 다르다 — 같은 말을 반복하면 읽었다는 느낌이 죽는다', () => {
    const lines = new Set([warnLine('CLOSE', 'W'), warnLine('CUT', 'W'), warnLine('BURN', 'W')]);
    expect(lines.size).toBe(3);
    expect(warnLine('CUT', 'W')).toContain('앞을 끊는다');
    expect(warnLine('BURN', 'W')).toContain('자리를 태운다');
  });

  it('kind가 없으면 디렉티브를 건드리지 않는다', () => {
    expect(sanitizeDirectiveForWarning(base, 'W', null)).toEqual(base);
  });
});
