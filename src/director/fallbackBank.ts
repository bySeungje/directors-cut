import { Directive, Mutation, WaveLog } from '../contracts/directive';
import { fillToBudgetFloor } from './validator';

export const OPENING_WAVE: Directive = {
  // 첫 웨이브는 한 방면에서만 들어온다 — 플레이어가 움직임 습관을 만들 여지를 주고, 그것을 읽는다.
  composition: [{ type: 'chaser', count: 8, spawn: 'E', elite: false }],
  mutation: 'NONE',
  buff: 'NONE',
  deny: 'NONE',
  taunt: '지금부터 너를 관찰한다.',
  intent: '기준선 수집: 이동 습관 관찰',
};

// export 심볼은 OPENING_WAVE 하나로 통일한다 (별칭 export 금지)
const BANK: Record<number, Directive[]> = {
  2: [
    { composition: [{ type: 'chaser', count: 6, spawn: 'PINCER', elite: false }, { type: 'shooter', count: 2, spawn: 'N', elite: false }], mutation: 'NONE', buff: 'NONE', deny: 'NONE', taunt: '1차 문은 닫혔다. 협공 프로토콜을 개방한다.', intent: '탐조등 구역: 순찰 협공 도입' },
    { composition: [{ type: 'chaser', count: 5, spawn: 'BEHIND', elite: false }, { type: 'shooter', count: 3, spawn: 'S', elite: false }], mutation: 'FOG', buff: 'NONE', deny: 'NONE', taunt: '어둠 속 탈출 루트는 이미 폐쇄했다.', intent: '탐조등 구역: 시야 제한 테스트' },
    { composition: [{ type: 'splitter', count: 5, spawn: 'RING', elite: false }], mutation: 'NONE', buff: 'NONE', deny: 'NONE', taunt: '하나를 부수면 둘이 감시한다.', intent: '탐조등 구역: 분열형 릴레이 도입' },
  ],
  3: [
    { composition: [{ type: 'chaser', count: 7, spawn: 'N', elite: false }, { type: 'shooter', count: 4, spawn: 'S', elite: false }], mutation: 'LAVA_LEFT', buff: 'NONE', deny: 'NONE', taunt: '왼쪽은 이제 내 구역이다.', intent: '공간 압박' },
    { composition: [{ type: 'splitter', count: 7, spawn: 'PINCER', elite: false }], mutation: 'SPEED_SURGE', buff: 'NONE', deny: 'NONE', taunt: '속도를 올려보지.', intent: '릴레이 순찰 템포 상승' },
    { composition: [{ type: 'chaser', count: 3, spawn: 'RING', elite: true }], mutation: 'SPAWN_STORM', buff: 'NONE', deny: 'NONE', taunt: '정예를 보낸다. 영광으로 알아라.', intent: '엘리트 도입' },
  ],
  4: [
    { composition: [{ type: 'shooter', count: 5, spawn: 'RING', elite: false }, { type: 'chaser', count: 6, spawn: 'BEHIND', elite: false }], mutation: 'SHRINK_ARENA', buff: 'NONE', deny: 'NONE', taunt: '보안 구역을 압축한다. 도망칠 곳도 줄어든다.', intent: '공간 축소 압박' },
    { composition: [{ type: 'splitter', count: 6, spawn: 'N', elite: false }, { type: 'shooter', count: 4, spawn: 'S', elite: false }], mutation: 'FOG', buff: 'NONE', deny: 'NONE', taunt: '보이지 않는 것이 가장 무섭다.', intent: '시야+릴레이 복합' },
    { composition: [{ type: 'chaser', count: 8, spawn: 'PINCER', elite: false }, { type: 'shooter', count: 5, spawn: 'RING', elite: false }], mutation: 'NONE', buff: 'NONE', deny: 'NONE', taunt: '복도마다 눈을 배치했다.', intent: '순찰 밀도 상승' },
  ],
  5: [
    { composition: [{ type: 'chaser', count: 8, spawn: 'RING', elite: false }, { type: 'splitter', count: 7, spawn: 'PINCER', elite: false }], mutation: 'LAVA_LEFT', buff: 'NONE', deny: 'NONE', taunt: '반복 루트는 오래 살아남지 못한다.', intent: '지속 순찰 압박' },
    { composition: [{ type: 'shooter', count: 3, spawn: 'RING', elite: true }, { type: 'chaser', count: 7, spawn: 'BEHIND', elite: false }], mutation: 'LAVA_RIGHT', buff: 'NONE', deny: 'NONE', taunt: '오른쪽을 지운다.', intent: '엘리트 감시 드론 + 공간 압박' },
    { composition: [{ type: 'chaser', count: 8, spawn: 'BEHIND', elite: false }, { type: 'shooter', count: 6, spawn: 'N', elite: false }], mutation: 'SPEED_SURGE', buff: 'NONE', deny: 'NONE', taunt: '이 속도를 따라올 수 있나.', intent: '고속 순찰망' },
  ],
  6: [
    { composition: [{ type: 'splitter', count: 8, spawn: 'RING', elite: false }, { type: 'chaser', count: 9, spawn: 'PINCER', elite: false }, { type: 'shooter', count: 4, spawn: 'N', elite: false }], mutation: 'FOG', buff: 'NONE', deny: 'NONE', taunt: '어둠, 릴레이, 협공. 전부 동시에.', intent: '복합 시험' },
    { composition: [{ type: 'shooter', count: 8, spawn: 'RING', elite: false }, { type: 'chaser', count: 10, spawn: 'BEHIND', elite: false }], mutation: 'SHRINK_ARENA', buff: 'NONE', deny: 'NONE', taunt: '숨을 곳은 없다.', intent: '감시망+축소' },
    { composition: [{ type: 'chaser', count: 9, spawn: 'N', elite: false }, { type: 'chaser', count: 9, spawn: 'S', elite: false }, { type: 'chaser', count: 2, spawn: 'RING', elite: true }], mutation: 'SPEED_SURGE', buff: 'NONE', deny: 'NONE', taunt: '최정예다. 물러설 곳도 없다.', intent: '엘리트 순찰 압박' },
  ],
  7: [
    { composition: [{ type: 'chaser', count: 12, spawn: 'RING', elite: false }, { type: 'shooter', count: 8, spawn: 'PINCER', elite: false }], mutation: 'SHRINK_ARENA', buff: 'NONE', deny: 'NONE', taunt: '마지막 봉쇄다. 모든 시야를 열어라.', intent: '피날레: 전면 감시망' },
    { composition: [{ type: 'splitter', count: 9, spawn: 'PINCER', elite: false }, { type: 'splitter', count: 9, spawn: 'RING', elite: false }], mutation: 'LAVA_HOTSPOT', buff: 'NONE', deny: 'NONE', taunt: '네가 믿은 경로를 봉쇄한다.', intent: '피날레: 릴레이 봉쇄' },
    { composition: [{ type: 'shooter', count: 3, spawn: 'RING', elite: true }, { type: 'chaser', count: 11, spawn: 'BEHIND', elite: false }, { type: 'chaser', count: 8, spawn: 'N', elite: false }], mutation: 'FOG', buff: 'NONE', deny: 'NONE', taunt: '엔딩은 어둠 속에서.', intent: '피날레: 암전 봉쇄' },
  ],
};

export function pickFallback(wave: number, prevMutation: Mutation, log?: WaveLog): Directive {
  const pool = (BANK[wave] ?? BANK[7]).filter((d) => d.mutation === 'NONE' || d.mutation !== prevMutation);
  const base = pool[Math.floor(Math.random() * pool.length)];
  const adapted = adaptToPlayerStyle(base, log, prevMutation);
  // 뱅크는 validateDirective를 거치지 않으므로 예산 하한이 걸리지 않는다 — 곡선을 올려도 폴백 경로는
  // 옛 크기 그대로였다. 그런데 API 키가 없는 심사자와 로컬 개발이 보는 것이 정확히 이 경로다.
  // 여기서 하한을 태워, 뱅크 19항목을 손으로 다시 쓰지 않고도 곡선 변경이 폴백에 그대로 반영되게 한다.
  return { ...adapted, composition: fillToBudgetFloor(adapted.composition, wave, adapted.buff) };
}

function adaptToPlayerStyle(base: Directive, log: WaveLog | undefined, prevMutation: Mutation): Directive {
  if (!log) return base;
  const manualAttacks = log.combat.manualAttacks ?? 0;
  const disables = Object.values(log.combat.kills).reduce((s, n) => s + (n ?? 0), 0);
  const attackHeavy = manualAttacks >= 4 || disables >= 3;
  const dashHeavy = log.movement.dashCount >= 8;
  const wallRoute = log.movement.wallHugRatio >= 0.46;
  const exposed = (log.stealth?.visionExposureSec ?? 0) >= 6;

  if (attackHeavy) {
    return {
      ...base,
      buff: 'TOUGH',
      deny: 'DAMAGE_UP',
      taunt: '너는 쏘는 쪽을 택했다. 그 손을 묶겠다.',
      intent: `${base.intent} + 공격 성향 대응`,
    };
  }
  if (dashHeavy) {
    return {
      ...base,
      buff: 'INTERCEPT',
      deny: 'DASH_CD_DOWN',
      taunt: '대시 돌파 패턴 확인. 이동 예측 감시를 켠다.',
      intent: `${base.intent} + 대시 성향 대응`,
    };
  }
  if (wallRoute && prevMutation !== 'LAVA_HOTSPOT') {
    return {
      ...base,
      mutation: 'LAVA_HOTSPOT',
      taunt: '벽면 우회 루트 확인. 네가 오래 머문 길부터 태운다.',
      intent: `${base.intent} + 벽면 루트 대응`,
    };
  }
  if (exposed) {
    return {
      ...base,
      buff: 'EVASIVE',
      taunt: '감시 노출이 길다. 다음 드론은 더 오래 시야를 유지한다.',
      intent: `${base.intent} + 노출 성향 대응`,
    };
  }
  return base;
}
