import type { WarnDirection } from './warning';

/**
 * 집행자 — **예고를 몸으로 만든 한 기.**
 *
 * 진단(2026-08-10 승제): "그냥 다가오는 적, 멀리서 총쏘는 적. 뭐가 부족한 걸까?"
 * 적 종류가 적어서가 아니었다. 아레나의 압력이 **전부 밀어내는 힘**이라 최적 플레이가 자동으로
 * "거리 유지하며 도는 것"으로 수렴하는데, AI는 하필 그 습관을 읽고 벌을 준다 — 레벨 디자인이
 * 강요한 유일한 전략을 처벌하는 구조였다. 킥이 없는 게 아니라 **선택이 없었다**(위치가 결정이 아니라 결과).
 *
 * 집행자는 하나로 셋을 갚는다:
 *  - 예고한 자리에 선다        → "AI가 나를 읽었다"가 글자가 아니라 화면 위 장애물이 된다
 *  - 원거리 탄이 안 통한다      → 처음으로 **다가가야 하는** 적
 *  - 깨면 뺏긴 능력을 되찾는다  → 아레나에 처음으로 **끌어당기는** 힘이 생긴다
 *
 * **시간 축내기가 아니다**: 안 죽여도 웨이브는 클리어된다(일반 적 그룹 밖에 있어 클리어 조건에 안 낀다).
 * 죽일지 말지가 선택이지 숙제가 아니고, 무시하면 그 구역을 잃을 뿐 추가 처벌은 없다 —
 * 이미 박탈로 벌을 주고 있어서 여기 또 벌을 얹으면 "읽히면 계속 손해"가 되어 플레이어가 무력해진다.
 *
 * 계약(`ENEMY_TYPES`)에 타입을 더하지 않는다 — 더하면 LLM 출력 스키마가 바뀌어 프록시 재배포가 강제된다.
 * Phaser를 import하지 않는다(habits·fireRule·warning·settlement·memory와 같은 이유).
 */

/** 이 거리 안에서만 피해가 들어간다. 밖에서 쏜 탄은 튕긴다. */
export const CLOSE_RANGE_PX = 130;
/** 집행자 체력 — 붙어서 몇 초면 깨진다. 오래 때리는 것이 목적이 아니라 붙는 것이 목적이다. */
export const ENFORCER_HP = 6;
/** 예고한 변에서 안쪽으로 들어온 비율. 가장자리에 딱 붙으면 접근 자체가 불가능해진다. */
const INSET = 0.22;

/** 원거리 탄이 튕기는가 — **이 게임에서 유일하게 "다가가야 하는" 규칙.** */
export function canDamageEnforcer(distance: number, closeRange: number = CLOSE_RANGE_PX): boolean {
  return distance <= closeRange;
}

/**
 * 집행자가 설 자리 — 예고한 방면 안쪽. 결정론이라 예고와 위치가 어긋날 수 없다.
 *
 * 가장자리가 아니라 안쪽(22%)에 서는 이유: 벽에 붙으면 플레이어가 등을 벽에 대고 접근할 수 없어
 * "붙어서 깬다"가 성립하지 않는다. 아레나 안쪽이라 사방에서 접근 가능하다.
 */
export function enforcerPosition(dir: WarnDirection, width: number, height: number): { x: number; y: number } {
  switch (dir) {
    case 'W': return { x: width * INSET, y: height / 2 };
    case 'E': return { x: width * (1 - INSET), y: height / 2 };
    case 'N': return { x: width / 2, y: height * INSET };
    case 'S': return { x: width / 2, y: height * (1 - INSET) };
  }
}
