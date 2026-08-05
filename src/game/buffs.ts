import { BuffCard, EnemyType } from '../contracts/directive';

/** 활성 강화 카드. 웨이브마다 setActiveBuff로 설정하고 웨이브 종료 시 clearBuff로 초기화한다(누적 금지). */
let active: BuffCard = 'NONE';

export function setActiveBuff(card: BuffCard): void {
  active = card;
}

export function clearBuff(): void {
  active = 'NONE';
}

export function getActiveBuff(): BuffCard {
  return active;
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
