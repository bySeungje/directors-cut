/**
 * 발사 판단 — **이 게임의 실패 축을 정의하는 술어.**
 *
 * Phaser를 import하지 않는 순수 모듈로 둔다(`habits.ts`와 같은 이유) — 노드 환경에서 테스트 가능해야
 * 회귀 가드가 성립한다.
 *
 * 배경: 구 구현은 가장 가까운 적을 자동 조준해 쿨다운마다 자동 발사했다. 그래서 플레이어가 "쏘지 못하는"
 * 상태가 존재하지 않았고, `docs/_hub/nodes/C-player-needs-a-failure-axis.md`가 종결한 대로 적을 아무리
 * 넣어도 처리 시간만 늘었다. 예산 곡선 ×2 · 적 이속 · shooter 선행 조준을 당겼지만 전부 "적을 강하게"
 * 축이라 실패했다.
 */

/**
 * 이번 프레임에 발사하는가.
 *
 * `pointerDown`이 거짓이면 쿨다운과 무관하게 **절대 발사하지 않는다** — 이 한 줄이 실패 축이다.
 *
 * **적을 인자로 받지 않는다는 사실 자체가 계약이다.** 조준·발사가 적의 존재와 무관하므로 빈 곳을 쏠 수
 * 있고, 그것이 명중률 100% 미만을 성립시킨다(스펙 `sc-miss-possible`).
 */
export function shouldFire(pointerDown: boolean, time: number, lastFireAt: number, fireRateMs: number): boolean {
  if (!pointerDown) return false;
  return time - lastFireAt >= fireRateMs;
}
