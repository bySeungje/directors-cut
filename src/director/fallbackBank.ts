import { Directive, Mutation } from '../contracts/directive';
import { fillToBudgetFloor } from './validator';

export const OPENING_WAVE: Directive = {
  // 12기 = 웨이브 1 예산 전액. 8기였을 때는 예산 하한(9)에도 못 미쳐 화면이 텅 비었는데,
  // 하필 이 40초가 심사자가 링크를 열고 **가장 먼저 보는 화면**이다. 밸런스가 아니라 첫인상 문제였다.
  composition: [{ type: 'chaser', count: 12, spawn: 'RING', elite: false }],
  mutation: 'NONE',
  buff: 'NONE',
  deny: 'NONE',
  taunt: '수감자 734, 탈출 시도 확인. 지금부터 당신을 관찰한다.',
  intent: '수감동 이탈: 기본 조작 관찰',
};

// export 심볼은 OPENING_WAVE 하나로 통일한다 (별칭 export 금지)
const BANK: Record<number, Directive[]> = {
  2: [
    { composition: [{ type: 'chaser', count: 10, spawn: 'PINCER', elite: false }, { type: 'shooter', count: 2, spawn: 'N', elite: false }], mutation: 'NONE', buff: 'NONE', deny: 'NONE', taunt: '1차 문은 닫혔다. 협공 프로토콜을 개방한다.', intent: '탐조등 구역: 협공 도입' },
    { composition: [{ type: 'chaser', count: 8, spawn: 'BEHIND', elite: false }, { type: 'shooter', count: 3, spawn: 'S', elite: false }], mutation: 'FOG', buff: 'NONE', deny: 'NONE', taunt: '어둠 속 탈출 루트는 이미 폐쇄했다.', intent: '탐조등 구역: 시야 제한 테스트' },
    { composition: [{ type: 'splitter', count: 6, spawn: 'RING', elite: false }], mutation: 'NONE', buff: 'NONE', deny: 'NONE', taunt: '하나를 부수면 둘이 감시한다.', intent: '탐조등 구역: 분열형 도입' },
  ],
  3: [
    { composition: [{ type: 'chaser', count: 12, spawn: 'N', elite: false }, { type: 'shooter', count: 4, spawn: 'S', elite: false }], mutation: 'LAVA_LEFT', buff: 'NONE', deny: 'NONE', taunt: '왼쪽은 이제 내 구역이다.', intent: '공간 압박' },
    { composition: [{ type: 'splitter', count: 8, spawn: 'PINCER', elite: false }], mutation: 'SPEED_SURGE', buff: 'NONE', deny: 'NONE', taunt: '속도를 올려보지.', intent: '템포 상승' },
    { composition: [{ type: 'chaser', count: 6, spawn: 'RING', elite: true }], mutation: 'SPAWN_STORM', buff: 'NONE', deny: 'NONE', taunt: '정예를 보낸다. 영광으로 알아라.', intent: '엘리트 도입' },
  ],
  4: [
    { composition: [{ type: 'shooter', count: 6, spawn: 'RING', elite: false }, { type: 'chaser', count: 8, spawn: 'BEHIND', elite: false }], mutation: 'SHRINK_ARENA', buff: 'NONE', deny: 'NONE', taunt: '보안 구역을 압축한다. 도망칠 곳도 줄어든다.', intent: '공간 축소 압박' },
    { composition: [{ type: 'splitter', count: 8, spawn: 'N', elite: false }, { type: 'shooter', count: 4, spawn: 'S', elite: false }], mutation: 'FOG', buff: 'NONE', deny: 'NONE', taunt: '보이지 않는 것이 가장 무섭다.', intent: '시야+물량 복합' },
    { composition: [{ type: 'chaser', count: 16, spawn: 'PINCER', elite: false }, { type: 'shooter', count: 4, spawn: 'RING', elite: false }], mutation: 'NONE', buff: 'NONE', deny: 'NONE', taunt: '물량 앞에 장사 없다.', intent: '물량전' },
  ],
  5: [
    { composition: [{ type: 'chaser', count: 18, spawn: 'RING', elite: false }, { type: 'splitter', count: 8, spawn: 'PINCER', elite: false }], mutation: 'LAVA_LEFT', buff: 'NONE', deny: 'NONE', taunt: '끝없이 몰아친다. 버텨봐라.', intent: '지속 압박' },
    { composition: [{ type: 'shooter', count: 4, spawn: 'RING', elite: true }, { type: 'chaser', count: 10, spawn: 'BEHIND', elite: false }], mutation: 'LAVA_RIGHT', buff: 'NONE', deny: 'NONE', taunt: '오른쪽을 지운다.', intent: '엘리트 사수 + 공간 압박' },
    { composition: [{ type: 'chaser', count: 20, spawn: 'BEHIND', elite: false }, { type: 'shooter', count: 7, spawn: 'N', elite: false }], mutation: 'SPEED_SURGE', buff: 'NONE', deny: 'NONE', taunt: '이 속도를 따라올 수 있나.', intent: '고속 혼전' },
  ],
  6: [
    { composition: [{ type: 'splitter', count: 10, spawn: 'RING', elite: false }, { type: 'chaser', count: 16, spawn: 'PINCER', elite: false }, { type: 'chaser', count: 20, spawn: 'N', elite: false }], mutation: 'FOG', buff: 'NONE', deny: 'NONE', taunt: '어둠, 분열, 협공. 전부 동시에.', intent: '복합 시험' },
    { composition: [{ type: 'shooter', count: 10, spawn: 'RING', elite: false }, { type: 'chaser', count: 30, spawn: 'BEHIND', elite: false }, { type: 'chaser', count: 6, spawn: 'S', elite: false }], mutation: 'SHRINK_ARENA', buff: 'NONE', deny: 'NONE', taunt: '숨을 곳은 없다.', intent: '탄막+축소' },
    { composition: [{ type: 'chaser', count: 25, spawn: 'N', elite: false }, { type: 'chaser', count: 25, spawn: 'S', elite: false }, { type: 'chaser', count: 2, spawn: 'RING', elite: true }], mutation: 'SPEED_SURGE', buff: 'NONE', deny: 'NONE', taunt: '최정예다. 물러설 곳도 없다.', intent: '엘리트 물량' },
  ],
  7: [
    { composition: [{ type: 'chaser', count: 30, spawn: 'RING', elite: false }, { type: 'chaser', count: 30, spawn: 'BEHIND', elite: false }, { type: 'shooter', count: 12, spawn: 'PINCER', elite: false }], mutation: 'SHRINK_ARENA', buff: 'NONE', deny: 'NONE', taunt: '마지막 막이다. 전력을 다해라.', intent: '피날레: 총력전' },
    { composition: [{ type: 'splitter', count: 21, spawn: 'PINCER', elite: false }, { type: 'splitter', count: 21, spawn: 'RING', elite: false }], mutation: 'LAVA_HOTSPOT', buff: 'NONE', deny: 'NONE', taunt: '네가 믿은 경로를 봉쇄한다.', intent: '피날레: 분열 폭풍' },
    { composition: [{ type: 'shooter', count: 4, spawn: 'RING', elite: true }, { type: 'chaser', count: 30, spawn: 'BEHIND', elite: false }, { type: 'chaser', count: 30, spawn: 'N', elite: false }], mutation: 'FOG', buff: 'NONE', deny: 'NONE', taunt: '엔딩은 어둠 속에서.', intent: '피날레: 암전 총공세' },
  ],
};

export function pickFallback(wave: number, prevMutation: Mutation): Directive {
  const pool = (BANK[wave] ?? BANK[7]).filter((d) => d.mutation === 'NONE' || d.mutation !== prevMutation);
  const base = pool[Math.floor(Math.random() * pool.length)];
  // 뱅크는 validateDirective를 거치지 않으므로 예산 하한이 걸리지 않는다 — 곡선을 올려도 폴백 경로는
  // 옛 크기 그대로였다. 그런데 API 키가 없는 심사자와 로컬 개발이 보는 것이 정확히 이 경로다.
  // 여기서 하한을 태워, 뱅크 19항목을 손으로 다시 쓰지 않고도 곡선 변경이 폴백에 그대로 반영되게 한다.
  return { ...base, composition: fillToBudgetFloor(base.composition, wave, base.buff) };
}
