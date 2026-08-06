import { BuffCard, EnemyType } from '../contracts/directive';

/** 활성 강화 카드. 웨이브마다 setActiveBuff로 설정하고 웨이브 종료 시 clearBuff로 초기화한다(누적 금지). */
let active: BuffCard = 'NONE';

/** 선행 시간 상한(초). 실제 선행은 `거리 ÷ 적 이속`이며 이 값으로 자른다 — 더 늘리면 과예측으로
 *  빗나가 오히려 거리가 벌어진다(스펙 §3.4.2 실측: 상한 2.5초일 때 159→166). */
export const INTERCEPT_MAX_LEAD_SEC = 1.5;
const ENCIRCLE_START_RADIUS = 200;
/** 포위 반경 하한. 여기 닿으면 조임이 끝난 것으로 보고 포위를 풀어 돌진한다(스펙 §3.4.2). */
const ENCIRCLE_MIN_RADIUS = 60;
const ENCIRCLE_CLOSE_PER_SEC = 25;

/** ENCIRCLE이 활성화된 시각(ms, scene.time.now 기준) — encircleRadius가 조여드는 정도를 계산하는 기준점. */
let activatedAt = 0;

export function setActiveBuff(card: BuffCard, now = 0): void {
  active = card;
  activatedAt = now;
}

export function clearBuff(): void {
  active = 'NONE';
  activatedAt = 0;
}

export function getActiveBuff(): BuffCard {
  return active;
}

export function isIntercept(): boolean { return active === 'INTERCEPT'; }
export function isEncircle(): boolean { return active === 'ENCIRCLE'; }

/** 회피 기동 — 흔들림 주기(ms)와 진폭(rad). 접근 자체는 계속하므로 무한 회피가 아니다(스펙 §3.4.3). */
export const EVASIVE_PERIOD_MS = 200;
export const EVASIVE_AMPLITUDE_RAD = 0.9;

export function isEvasive(): boolean { return active === 'EVASIVE'; }

/** 포위 반경 — 카드 활성 시점부터 초당 25px씩 조여든다. */
/** 조임이 끝났는가 — 이때부터 포위를 풀고 덮친다. 링 위에 멈춰 있으면 접촉 판정 밖에 대치선만
 *  생겨 포위 카드가 오히려 플레이어를 안전하게 만든다(스펙 §3.4.2 실측). */
export function encircleClosed(now: number): boolean {
  return encircleRadius(now) <= ENCIRCLE_MIN_RADIUS;
}

export function encircleRadius(now: number): number {
  const elapsedSec = Math.max(0, (now - activatedAt) / 1000);
  return Math.max(ENCIRCLE_MIN_RADIUS, ENCIRCLE_START_RADIUS - elapsedSec * ENCIRCLE_CLOSE_PER_SEC);
}

/** elite 배수까지 적용된 HP에 카드 효과를 얹는다. 최소 1 보장. */
export function buffedHp(type: EnemyType, baseHp: number): number {
  if (active === 'TOUGH') return baseHp + 1;
  if (active === 'RELENTLESS' && type === 'chaser') return Math.max(1, baseHp - 1);
  return baseHp;
}

/** elite 배수까지 적용된 이속에 카드 효과를 얹는다. mutation(SPEED_SURGE)은 매 프레임 별도 적용된다. */
export function buffedSpeed(type: EnemyType, baseSpeed: number): number {
  if (active === 'SWIFT') return baseSpeed * 1.25;
  if (active === 'RELENTLESS' && type === 'chaser') return baseSpeed * 1.45;
  return baseSpeed;
}

export function buffedFireInterval(base: number): number {
  return active === 'RAPID_FIRE' ? base * 0.6 : base;
}

export function buffedKeepDistance(base: number): number {
  return active === 'MARKSMAN' ? base + 80 : base;
}

export function buffedBulletSpeed(base: number): number {
  return active === 'MARKSMAN' ? base * 1.5 : base;
}

export function buffedSplitCount(): number {
  return active === 'VOLATILE' ? 3 : 2;
}
