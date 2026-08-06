import { Directive, Mutation } from '../contracts/directive';

export const OPENING_WAVE: Directive = {
  composition: [{ type: 'chaser', count: 8, spawn: 'RING', elite: false }],
  mutation: 'NONE',
  buff: 'NONE',
  deny: 'NONE',
  taunt: '환영한다. 지금부터 당신을 관찰한다.',
  intent: '오프닝: 기본 조작 관찰',
};

// export 심볼은 OPENING_WAVE 하나로 통일한다 (별칭 export 금지)
const BANK: Record<number, Directive[]> = {
  2: [
    { composition: [{ type: 'chaser', count: 10, spawn: 'PINCER', elite: false }, { type: 'shooter', count: 2, spawn: 'N', elite: false }], mutation: 'NONE', buff: 'NONE', deny: 'NONE', taunt: '워밍업은 끝났다.', intent: '협공 도입' },
    { composition: [{ type: 'chaser', count: 8, spawn: 'BEHIND', elite: false }, { type: 'shooter', count: 3, spawn: 'S', elite: false }], mutation: 'FOG', buff: 'NONE', deny: 'NONE', taunt: '어둠 속에서도 그렇게 움직일 수 있나.', intent: '시야 제한 테스트' },
    { composition: [{ type: 'splitter', count: 6, spawn: 'RING', elite: false }], mutation: 'NONE', buff: 'NONE', deny: 'NONE', taunt: '하나를 죽이면 둘이 된다.', intent: '분열형 도입' },
  ],
  3: [
    { composition: [{ type: 'chaser', count: 12, spawn: 'N', elite: false }, { type: 'shooter', count: 4, spawn: 'S', elite: false }], mutation: 'LAVA_LEFT', buff: 'NONE', deny: 'NONE', taunt: '왼쪽은 이제 내 구역이다.', intent: '공간 압박' },
    { composition: [{ type: 'splitter', count: 8, spawn: 'PINCER', elite: false }], mutation: 'SPEED_SURGE', buff: 'NONE', deny: 'NONE', taunt: '속도를 올려보지.', intent: '템포 상승' },
    { composition: [{ type: 'chaser', count: 6, spawn: 'RING', elite: true }], mutation: 'NONE', buff: 'NONE', deny: 'NONE', taunt: '정예를 보낸다. 영광으로 알아라.', intent: '엘리트 도입' },
  ],
  4: [
    { composition: [{ type: 'shooter', count: 6, spawn: 'RING', elite: false }, { type: 'chaser', count: 8, spawn: 'BEHIND', elite: false }], mutation: 'SHRINK_ARENA', buff: 'NONE', deny: 'NONE', taunt: '무대가 좁아진다. 도망칠 곳도.', intent: '공간 축소 압박' },
    { composition: [{ type: 'splitter', count: 8, spawn: 'N', elite: false }, { type: 'shooter', count: 4, spawn: 'S', elite: false }], mutation: 'FOG', buff: 'NONE', deny: 'NONE', taunt: '보이지 않는 것이 가장 무섭다.', intent: '시야+물량 복합' },
    { composition: [{ type: 'chaser', count: 16, spawn: 'PINCER', elite: false }, { type: 'shooter', count: 4, spawn: 'RING', elite: false }], mutation: 'NONE', buff: 'NONE', deny: 'NONE', taunt: '물량 앞에 장사 없다.', intent: '물량전' },
  ],
  5: [
    { composition: [{ type: 'chaser', count: 10, spawn: 'RING', elite: false }, { type: 'splitter', count: 6, spawn: 'PINCER', elite: false }], mutation: 'SPAWN_STORM', buff: 'NONE', deny: 'NONE', taunt: '끝없이 몰아친다. 버텨봐라.', intent: '지속 압박' },
    { composition: [{ type: 'shooter', count: 4, spawn: 'RING', elite: true }], mutation: 'LAVA_RIGHT', buff: 'NONE', deny: 'NONE', taunt: '오른쪽을 지운다.', intent: '엘리트 사수 + 공간 압박' },
    { composition: [{ type: 'chaser', count: 14, spawn: 'BEHIND', elite: false }, { type: 'shooter', count: 6, spawn: 'N', elite: false }], mutation: 'SPEED_SURGE', buff: 'NONE', deny: 'NONE', taunt: '이 속도를 따라올 수 있나.', intent: '고속 혼전' },
  ],
  6: [
    { composition: [{ type: 'splitter', count: 10, spawn: 'RING', elite: false }, { type: 'chaser', count: 8, spawn: 'PINCER', elite: true }], mutation: 'FOG', buff: 'NONE', deny: 'NONE', taunt: '어둠, 분열, 협공. 전부 동시에.', intent: '복합 시험' },
    { composition: [{ type: 'shooter', count: 8, spawn: 'RING', elite: false }, { type: 'chaser', count: 12, spawn: 'BEHIND', elite: false }], mutation: 'SHRINK_ARENA', buff: 'NONE', deny: 'NONE', taunt: '숨을 곳은 없다.', intent: '탄막+축소' },
    { composition: [{ type: 'chaser', count: 10, spawn: 'N', elite: true }], mutation: 'SPAWN_STORM', buff: 'NONE', deny: 'NONE', taunt: '최정예다. 물러설 곳도 없다.', intent: '엘리트 물량' },
  ],
  7: [
    { composition: [{ type: 'chaser', count: 12, spawn: 'RING', elite: true }, { type: 'shooter', count: 4, spawn: 'PINCER', elite: false }], mutation: 'SHRINK_ARENA', buff: 'NONE', deny: 'NONE', taunt: '마지막 막이다. 전력을 다해라.', intent: '피날레: 총력전' },
    { composition: [{ type: 'splitter', count: 10, spawn: 'PINCER', elite: true }], mutation: 'SPAWN_STORM', buff: 'NONE', deny: 'NONE', taunt: '이것이 나의 연출이다.', intent: '피날레: 분열 폭풍' },
    { composition: [{ type: 'shooter', count: 6, spawn: 'RING', elite: true }, { type: 'chaser', count: 10, spawn: 'BEHIND', elite: false }], mutation: 'FOG', buff: 'NONE', deny: 'NONE', taunt: '엔딩은 어둠 속에서.', intent: '피날레: 암전 총공세' },
  ],
};

export function pickFallback(wave: number, prevMutation: Mutation): Directive {
  const pool = (BANK[wave] ?? BANK[7]).filter((d) => d.mutation === 'NONE' || d.mutation !== prevMutation);
  return pool[Math.floor(Math.random() * pool.length)];
}
