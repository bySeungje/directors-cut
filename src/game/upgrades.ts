import type { PlayerStats } from './entities';
import type { DenyTarget } from '../contracts/directive';

export const UPGRADE_IDS = [
  'DAMAGE_UP', 'FIRE_RATE_UP', 'MOVE_SPEED_UP', 'HP_PLUS',
  'PIERCE', 'MULTI_SHOT', 'BULLET_SPEED_UP', 'DASH_CD_DOWN',
] as const;

export type UpgradeId = (typeof UPGRADE_IDS)[number];

export interface UpgradeDef {
  name: string;
  desc: string;
  /** 새 스탯 객체를 반환한다(불변 — 인자로 받은 stats는 건드리지 않는다) */
  apply(stats: PlayerStats): PlayerStats;
}

// 하트 HUD가 원래 5칸 고정이라 무한 성장은 레이아웃이 못 받는다 — 상한 8로 캡(재량 결정, 리포트 기록).
const MAX_HP_CAP = 8;

// 카드 desc 문구는 시안 v1 SCREEN 03(업그레이드 카드)의 문법을 따른다 — 수치보다 체감 문장(관통·연사 강화·대시 냉각 단축은 시안 원문과 동일).
export const UPGRADES: Record<UpgradeId, UpgradeDef> = {
  DAMAGE_UP: {
    name: '데미지 강화',
    desc: '공격력 +1',
    apply: (s) => ({ ...s, damage: s.damage + 1 }),
  },
  FIRE_RATE_UP: {
    name: '연사 강화',
    desc: '발사 간격 15% 감소',
    apply: (s) => ({ ...s, fireRateMs: s.fireRateMs * 0.85 }),
  },
  MOVE_SPEED_UP: {
    name: '기동 강화',
    desc: '이동속도 +12%',
    apply: (s) => ({ ...s, moveSpeed: s.moveSpeed * 1.12 }),
  },
  HP_PLUS: {
    name: '체력 강화',
    desc: '최대 체력 +1, 즉시 회복',
    apply: (s) => ({ ...s, maxHp: Math.min(MAX_HP_CAP, s.maxHp + 1) }),
  },
  PIERCE: {
    name: '관통',
    desc: '탄이 적 1기를 뚫고 지나간다',
    apply: (s) => ({ ...s, pierce: s.pierce + 1 }),
  },
  MULTI_SHOT: {
    name: '멀티샷',
    desc: '탄이 부채꼴로 한 발 더 나간다',
    apply: (s) => ({ ...s, multishot: s.multishot + 1 }),
  },
  BULLET_SPEED_UP: {
    name: '탄속 강화',
    desc: '탄속 +20%',
    apply: (s) => ({ ...s, bulletSpeed: s.bulletSpeed * 1.2 }),
  },
  DASH_CD_DOWN: {
    name: '대시 냉각 단축',
    desc: '대시 쿨다운 20% 감소',
    apply: (s) => ({ ...s, dashCooldownMs: s.dashCooldownMs * 0.8 }),
  },
};

/** 무작위 3종(중복 없음) — pool에서 하나씩 splice로 뽑아내 이미 뽑힌 항목이 재추첨되지 않게 한다.
 *  deny가 NONE이 아니면 해당 업그레이드를 후보 풀에서 제외한다(디렉터의 봉인 — src/contracts/directive.ts). */
export function pick3(deny: DenyTarget = 'NONE'): UpgradeId[] {
  const pool = (UPGRADE_IDS as readonly UpgradeId[]).filter((id) => id !== deny);
  const picked: UpgradeId[] = [];
  for (let i = 0; i < 3 && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(idx, 1)[0]);
  }
  return picked;
}
