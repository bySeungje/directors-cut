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

/** 처치 1기가 더하는 점수. */
export function killGain(multiplier: number): number {
  return Math.round(KILL_SCORE * multiplier);
}
