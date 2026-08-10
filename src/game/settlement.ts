import type { Verdict } from './habits';

/**
 * 배수 정산 — **읽기에 붙는 수치.**
 *
 * `docs/_hub/nodes/D-settlement-in-arena.md`가 확정한 대로 정산은 인터벌 성적표가 아니라 아레나 안에서
 * 일어난다. 이 게임의 원 진단은 "전투 40초에 증가하는 수치가 하나도 없다"였고, 배수는 그 수치를 만들되
 * **잘 쏴서 오르지 않게** 한다 — 예고를 깨야 오른다. 그래야 세어지는 값이 "AI를 읽었다"를 가리킨다.
 *
 * 정산이 작동하는 네 조건(같은 노드): 결과가 불투명 · 명시적 결정에서 나옴 · 다음 비트로 이어짐 ·
 * 원인과의 시차가 짧음. 배수는 넷을 다 만족한다 — 예고를 보고 행동을 바꿀지가 결정이고, 판정은
 * 웨이브 끝에 나며, 배수는 다음 웨이브로 이어지고, 점수는 처치 즉시 오른다.
 *
 * Phaser를 import하지 않는다(habits.ts·fireRule.ts·warning.ts와 같은 이유).
 */

/** 시작 배수.
 *
 *  하한(1.0)에서 시작하면 적중당해도 배수가 안 움직여서, **심사자가 60초 플레이하는 동안 정산이
 *  한 번도 보이지 않을 수 있다**(2026-08-10 Playwright 실측: 100초 동안 판정 1회, 배수 하한 고정).
 *  하한에서 띄워 두면 웨이브 2의 첫 판정부터 양방향이 다 보인다 — 정산은 보여야 정산이다. */
export const MULT_START = 1.5;
export const MULT_ON_BROKEN = 0.5;
export const MULT_ON_HIT = -0.3;
export const MULT_MIN = 1.0;
export const MULT_MAX = 5.0;
/** 처치 1기의 기본 점수. 배수가 곱해져 즉시 누적된다(시차 0). */
export const KILL_SCORE = 10;

/** 판정이 배수를 어디로 옮기는가. VOID는 움직이지 않는다 — 디렉터가 지표를 강제한 웨이브는 무효이므로
 *  플레이어에게 이득도 손해도 주지 않는다(C-mutation-judge-collision의 정신 그대로). */
export function nextMultiplier(current: number, verdict: Verdict): number {
  const delta = verdict === 'HIT' ? MULT_ON_HIT : verdict === 'BROKEN' ? MULT_ON_BROKEN : 0;
  return Math.min(MULT_MAX, Math.max(MULT_MIN, current + delta));
}

/**
 * 판정이 **무엇을 가져가는가.**
 *
 * 이 게임의 대응은 강화가 아니라 **박탈**이다. "다음 편대는 더 단단해진다"는 플레이어의 결정을 하나도
 * 바꾸지 않는다 — 하던 걸 그대로 하면 되고 다만 오래 걸릴 뿐이라, 물량을 늘리는 것과 같은 시간 축내기다.
 * 읽혔으면 **기대던 것을 잃어야** 다음 판의 선택이 달라진다.
 *
 * 대시를 고른 이유: (1) 플레이어가 가장 많이 기대는 탈출 수단이고 (2) **변주가 아니라 플레이어 상태**라
 * 습관 판정을 무효로 만들지 않는다. 용암·안개 같은 변주로 박탈하면 그 변주가 판정 지표를 강제해
 * 판정이 VOID가 되고, 배수가 영원히 멈춘다(`docs/_hub/nodes/C-mutation-judge-collision.md`).
 *
 * 예고를 깨면 잃지 않는다 — 그래서 "AI를 읽는 것"이 취향이 아니라 **내 능력을 지키는 일**이 된다.
 */
export type Deprivation = 'DASH_LOCK' | 'NO_MULTI' | 'SLOW_FIRE' | null;

/** 박탈 후보의 사람 말 이름 — 화면과 로그가 같은 단어를 쓴다. */
export const DEPRIVATION_WORD: Record<NonNullable<Deprivation>, string> = {
  DASH_LOCK: '대시',
  NO_MULTI: '다중 발사',
  SLOW_FIRE: '연사',
};

/** 박탈 선택의 입력 — 플레이어가 **무엇에 기대고 있는지**의 실측값. */
export interface RelianceSample {
  /** 대시 쿨다운 가동률 0~1 */
  dashUptime: number;
  /** 현재 동시 발사 수 */
  multishot: number;
  /** 명중률 0~1 */
  accuracy: number;
}

/** 난사로 커버한다고 보는 명중률 상한. 이 아래면 조준이 아니라 물량으로 맞히고 있다. */
export const SPRAY_ACCURACY = 0.55;
/** 대시에 기댄다고 보는 가동률 하한. 쓸 수 있을 때의 절반 이상을 쓴다. */
export const DASH_RELIANCE = 0.5;

/**
 * **무엇을 가져갈 것인가** — 읽혔을 때 AI가 고르는 무기.
 *
 * 하나로 고정하면(항상 대시) 두 판이면 예측 가능해지고, 그 순간 "AI가 나를 공략한다"가 아니라
 * "규칙이 하나 더 있다"가 된다. 그래서 **그 사람이 실제로 기대는 것**을 실측에서 고른다.
 *
 * 순서는 "얼마나 반사적으로 기대는가"다 — 대시는 몸이 먼저 쓰고, 다중 발사는 빌드 선택이며,
 * 난사는 조준을 대신하는 습관이다. 아무것도 두드러지지 않으면 대시로 떨어진다(가장 보편적인 의존).
 *
 * 셋 다 **변주가 아니라 플레이어 상태**다 — 변주로 빼앗으면 그 변주가 판정 지표를 강제해 판정이
 * VOID가 되고 배수가 영원히 멈춘다(`docs/_hub/nodes/C-mutation-judge-collision.md`).
 */
export function chooseDeprivation(verdict: Verdict, r: RelianceSample): Deprivation {
  if (verdict !== 'HIT') return null;
  if (r.dashUptime >= DASH_RELIANCE) return 'DASH_LOCK';
  if (r.multishot > 1) return 'NO_MULTI';
  if (r.accuracy > 0 && r.accuracy < SPRAY_ACCURACY) return 'SLOW_FIRE';
  return 'DASH_LOCK';
}

/** 처치 1기가 더하는 점수. */
export function killGain(multiplier: number): number {
  return Math.round(KILL_SCORE * multiplier);
}
