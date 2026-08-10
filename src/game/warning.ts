import type { Directive, Mutation, BuffCard, SpawnPattern } from '../contracts/directive';
import type { HabitId } from './habits';

/**
 * 예고(warning) — **이 게임의 유일한 성공 조건을 지키는 모듈.**
 *
 * 소름은 관찰과 재배치를 구현했다고 나오지 않는다. **예고가 실행보다 먼저 나올 때만** 난다:
 *
 *   관찰("너는 왼쪽 3분의 1에서 82% 머물렀다")
 *     → 1.2초 뒤 예고("그래서 왼쪽을 닫는다")   ← 아직 아무 일도 일어나지 않는다. 여기가 소름의 자리
 *     → 다음 웨이브에서 예고한 쪽에 마커가 0.6초 먼저
 *     → 그 자리에서 적이 나온다
 *     → 웨이브 종료 시 예고와 판정을 나란히
 *
 * 말이 먼저, 그림이 나중. 순서가 뒤집히면 같은 코드로도 소름이 나지 않는다.
 *
 * 이 모듈이 순수 함수인 이유: **인과가 깨지는 경로를 테스트로 잡기 위해서다.** 예고한 방향과 실제로
 * 벌어지는 일이 어긋나면 "AI가 나를 읽었다"가 "AI가 헛소리한다"가 된다.
 *
 * Phaser를 import하지 않는다(`habits.ts`·`fireRule.ts`와 같은 이유).
 */

export type WarnDirection = 'N' | 'S' | 'E' | 'W';

/** 예고 문장 — 화면에 뜨는 그대로. 방향은 플레이어가 머물던 쪽이고, 디렉터는 그곳을 "닫는다". */
/** 예고의 성격 — 무엇으로 갚을 것인가.
 *
 *  **물량이 아니라 표적 대응이다.** 웨이브 번호를 올려 적을 더 넣는 것은 습관을 읽은 결과가 아니라
 *  시간의 결과다. 읽었다면 읽은 대로 갚아야 한다:
 *   - `CLOSE`  머문 방면을 닫는다 (위치 습관 — 어디 있는가)
 *   - `CUT`    도는 앞을 끊는다 (선회 습관 — 어떻게 도는가)
 *   - `BURN`   서 있는 자리를 태운다 (미세 회피 — 좁게 흔드는가) */
export type WarnKind = 'CLOSE' | 'CUT' | 'BURN';

export const WARN_TEXT: Record<WarnDirection, string> = {
  W: '그래서 왼쪽을 닫는다',
  E: '그래서 오른쪽을 닫는다',
  N: '그래서 위쪽을 닫는다',
  S: '그래서 아래쪽을 닫는다',
};

/**
 * 예고가 활성인 웨이브에서 **인과를 지우는 변주**.
 *
 * `FOG`는 플레이어 주변 240px만 남기고 나머지를 불투명도 0.85로 덮으며, 그 레이어가 depth 500으로
 * **엔티티보다 위에** 그려진다(`mutations.ts` FOG_DEPTH). 즉 예고한 쪽의 스폰 마커도 적도 보이지 않는다.
 * 성공 기준(방향 일치율)은 100%로 통과하는데 **화면에서는 인과가 보이지 않는** 형태의 실패다.
 *
 * `SPAWN_STORM`은 구성을 3분할해 4초 간격으로 뿌린다 — 마커 0.6초 선행이 첫 배치에만 걸려
 * "예고한 자리에서 나온다"는 읽기가 흐려진다.
 */
const CAUSALITY_ERASING_MUTATIONS: readonly Mutation[] = ['FOG', 'SPAWN_STORM'];

/**
 * 예고가 활성인 웨이브에서 **인과를 지우는 강화 카드**.
 *
 * `ENCIRCLE`은 적을 반경 200px에서 초당 25px씩 조여 약 5.6초 만에 플레이어 주위 60px 링으로 모은다.
 * 어느 방향에서 나왔든 곧 사방이 되므로 "왼쪽에서 왔다"는 읽기가 지워진다.
 * `EVASIVE`는 접근 경로를 흔들어 방향 읽기를 흐린다.
 */
const CAUSALITY_ERASING_BUFFS: readonly BuffCard[] = ['ENCIRCLE', 'EVASIVE'];

/** 4방면 — 예고 가능한 방향은 이 넷뿐이다. RING/PINCER/BEHIND는 플레이어 위치 기준이라 예고와 어긋난다. */
const CARDINALS: readonly WarnDirection[] = ['N', 'E', 'S', 'W'];

/**
 * 관찰된 습관과 체류 좌표에서 **닫을 방향**을 결정론으로 고른다.
 *
 * LLM이 죽어도 이 함수가 방향을 정하므로 예고와 스폰의 인과가 유지된다(스펙 `req-llm-fallback`).
 * LLM은 문장만 쓰고 방향은 언제나 엔진이 정한다 — 좌표·수치를 LLM이 만들지 않는다는 2층 구조 그대로다.
 *
 * @param x,y  플레이어가 가장 오래 머문 지점(핫스팟). 없으면 아레나 중앙을 넘긴다.
 */
export function directionFromHotspot(x: number, y: number, width: number, height: number): WarnDirection {
  // 중앙 기준 정규화 좌표에서 더 치우친 축을 고른다. 정확히 중앙이면 'E'(결정론 — 무작위 금지).
  const dx = x / width - 0.5;
  const dy = y / height - 0.5;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'E' : 'W';
  return dy >= 0 ? 'S' : 'N';
}

/** 이 습관을 무엇으로 갚는가. null이면 예고 없는 웨이브(대시 습관은 방향도 자리도 없다). */
export function warnKindFor(habit: HabitId | null): WarnKind | null {
  if (habit === 'ANCHOR' || habit === 'CORNER') return 'CLOSE';
  if (habit === 'ORBIT') return 'CUT';
  if (habit === 'MICRO') return 'BURN';
  return null;
}

/** 예고 대상이 되는 습관인가. */
export function habitHasDirection(habit: HabitId | null): boolean {
  return warnKindFor(habit) !== null;
}

/** 선회형 대응 — **도는 앞**을 막는다. 지금 있는 각도에서 진행 방향으로 90도 앞선 방면.
 *  머문 자리를 닫는 것(CLOSE)과 다르다: 이쪽은 플레이어가 *가려는 곳*을 먼저 잡는다. */
export function directionAheadOfOrbit(x: number, y: number, width: number, height: number, orbitSign: number): WarnDirection {
  const ang = Math.atan2(y - height / 2, x - width / 2);
  const ahead = ang + (orbitSign >= 0 ? 1 : -1) * (Math.PI / 2);
  const deg = ((ahead * 180) / Math.PI + 360) % 360;
  if (deg >= 315 || deg < 45) return 'E';
  if (deg < 135) return 'S';
  if (deg < 225) return 'W';
  return 'N';
}

/** 예고 성격별 문장. 방향이 들어가는 것은 CLOSE·CUT뿐이고 BURN은 자리를 태운다. */
export function warnLine(kind: WarnKind, dir: WarnDirection): string {
  if (kind === 'CLOSE') return WARN_TEXT[dir];
  if (kind === 'CUT') return `그래서 ${DIR_WORD[dir]} 앞을 끊는다`;
  return '그래서 네가 선 자리를 태운다';
}

const DIR_WORD: Record<WarnDirection, string> = { W: '왼쪽', E: '오른쪽', N: '위', S: '아래' };

/** 예고 성격이 강제하는 변주 — 표적 대응의 실행부. BURN은 머문 자리를 실제로 태운다. */
export function mutationForKind(kind: WarnKind): 'LAVA_HOTSPOT' | null {
  return kind === 'BURN' ? 'LAVA_HOTSPOT' : null;
}

/**
 * 예고한 방향과 **실제로 벌어지는 일**을 일치시킨다.
 *
 * 셋을 강제한다:
 *  1. 모든 composition의 spawn을 예고 방향으로 고정 (RING/PINCER/BEHIND 포함 — 이 셋은 플레이어 위치
 *     기준이라 예고한 화면 방향과 어긋날 수 있다)
 *  2. 인과를 지우는 변주를 NONE으로 (FOG가 예고한 쪽을 덮는 문제)
 *  3. 인과를 지우는 강화 카드를 NONE으로 (ENCIRCLE이 방향 읽기를 지우는 문제)
 *
 * 예고가 없는 웨이브(`dir === null`)에는 아무것도 건드리지 않는다 — 변주·카드의 다양성은 그때 살아난다.
 */
export function sanitizeDirectiveForWarning(
  d: Directive, dir: WarnDirection | null, kind: WarnKind | null = 'CLOSE',
): Directive {
  if (!dir || !kind) return d;
  const forced = mutationForKind(kind);
  return {
    ...d,
    composition: d.composition.map((c) => ({ ...c, spawn: dir as SpawnPattern })),
    // 표적 대응이 있으면 그것을 쓰고, 없으면 인과를 지우는 변주만 걷어낸다.
    mutation: forced ?? (CAUSALITY_ERASING_MUTATIONS.includes(d.mutation) ? 'NONE' : d.mutation),
    buff: CAUSALITY_ERASING_BUFFS.includes(d.buff) ? 'NONE' : d.buff,
  };
}

/** 이 변주/카드가 예고 웨이브에서 차단되는가 — 테스트와 로깅이 같은 목록을 보게 한다. */
export function erasesCausality(mutation: Mutation, buff: BuffCard): boolean {
  return CAUSALITY_ERASING_MUTATIONS.includes(mutation) || CAUSALITY_ERASING_BUFFS.includes(buff);
}

export { CARDINALS };
