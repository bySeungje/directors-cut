/**
 * 예측 타격 — **랜덤이 절대 흉내 낼 수 없는 유일한 증거.**
 *
 * 진단(2026-08-10 승제): "내 움직임을 분석해서 스킬 뺏고 지형 방해 말고는 없잖아.
 * 사실상 그것들은 내 플레이 로그를 몰라도 랜덤으로 할 수 있는 거란 말이지."
 *
 * 맞다. 능력을 무작위로 뺏어도, 용암을 무작위 위치에 깔아도 플레이어는 구분하지 못한다.
 * AI의 읽기가 **주장으로만 존재하고 반증이 불가능**하면 그것은 지능의 증거가 아니다.
 *
 * 랜덤이 못 하는 일은 하나뿐이다 — **아직 가지 않은 자리를 맞히는 것.**
 * 이 모듈은 위협받을 때 플레이어가 **습관적으로 튀는 방향**을 누적하고, 그 방향으로 미리 타격을 예고한다.
 * 1초 뒤 그 자리가 터진다. 하던 대로 튀면 맞고, 반사를 거스르면 빗나간다.
 *
 * **플레이어가 직접 반증할 수 있다는 것**이 이 설계의 핵심이다. 일부러 평소와 다른 쪽으로 움직여 보면
 * 빗나가는 것이 눈에 보인다 — 랜덤이면 그 실험이 성립하지 않는다.
 *
 * 현재 속도 기반 선행 조준(`entities.ts`의 shooter 선행, INTERCEPT 카드)과 다르다. 그쪽은 물리지 읽기가
 * 아니다 — 지금 가고 있는 방향을 외삽할 뿐이라 방향을 꺾으면 무조건 빗나간다.
 * 이쪽은 **누적된 반사 패턴**을 쓰므로, 정지 상태에서 위협이 오는 순간에도 예측이 성립한다.
 *
 * Phaser를 import하지 않는다(habits·fireRule·warning·settlement·memory와 같은 이유).
 */

/** 8방위 단위 벡터. 인덱스 0 = 오른쪽, 시계 방향. */
export const ESCAPE_DIRS: readonly { x: number; y: number }[] = Array.from({ length: 8 }, (_, i) => {
  const a = (i * Math.PI) / 4;
  return { x: Math.cos(a), y: Math.sin(a) };
});

export const ESCAPE_WORD: readonly string[] = [
  '오른쪽', '오른쪽 아래', '아래', '왼쪽 아래', '왼쪽', '왼쪽 위', '위', '오른쪽 위',
];

/** 이 비율 이상 한 방향으로 튀어야 "습관"이라고 부른다. 균등이면 12.5%이므로 그 두 배 이상. */
export const ESCAPE_SHARE_MIN = 0.28;
/** 판정에 필요한 최소 누적 시간(초). 이보다 적으면 데이터 없음이지 습관 아님이다
 *  (`docs/_hub/nodes/C-zero-is-absence.md` 계열). */
export const ESCAPE_MIN_SAMPLE_SEC = 2.5;
/** 예측 지점까지의 거리(px). 플레이어 이속 220 × 약 0.8초 — 하던 대로 튀면 정확히 닿는 거리. */
export const PREDICT_DISTANCE_PX = 170;
/** 예고 후 폭발까지(ms). 이 시간 안에 반사를 거스르면 빠져나갈 수 있어야 한다. */
export const TELEGRAPH_MS = 1000;
/** 폭발 반경(px). */
export const STRIKE_RADIUS_PX = 78;

/** 속도 벡터를 8방위 인덱스로. 정지(길이 0)면 null. */
export function escapeIndexOf(vx: number, vy: number): number | null {
  if (Math.hypot(vx, vy) < 1) return null;
  const a = Math.atan2(vy, vx);
  const i = Math.round(a / (Math.PI / 4));
  return ((i % 8) + 8) % 8;
}

/**
 * 누적 도망 방향에서 지배적인 하나를 고른다.
 *
 * 데이터가 부족하거나 어느 방향도 두드러지지 않으면 null — **없는 습관을 지어내지 않는다.**
 * 골고루 튀는 플레이어에게는 예측 타격이 발동하지 않고, 그것 자체가 정직한 결과다.
 */
export function dominantEscape(bins: readonly number[]): { index: number; share: number } | null {
  const total = bins.reduce((a, b) => a + b, 0);
  if (total < ESCAPE_MIN_SAMPLE_SEC) return null;
  let best = 0;
  for (let i = 1; i < bins.length; i++) if (bins[i] > bins[best]) best = i;
  const share = bins[best] / total;
  return share >= ESCAPE_SHARE_MIN ? { index: best, share } : null;
}

/** 예측 지점 — 지금 위치에서 습관 방향으로. 아레나 밖으로 나가지 않게 클램프한다. */
export function predictedPoint(
  x: number, y: number, index: number, width: number, height: number,
  distance: number = PREDICT_DISTANCE_PX,
): { x: number; y: number } {
  const d = ESCAPE_DIRS[index];
  const pad = STRIKE_RADIUS_PX * 0.5;
  return {
    x: Math.min(width - pad, Math.max(pad, x + d.x * distance)),
    y: Math.min(height - pad, Math.max(pad, y + d.y * distance)),
  };
}

/** 터진 자리에 플레이어가 있었는가. */
export function strikeHits(px: number, py: number, tx: number, ty: number, radius: number = STRIKE_RADIUS_PX): boolean {
  return Math.hypot(px - tx, py - ty) <= radius;
}
