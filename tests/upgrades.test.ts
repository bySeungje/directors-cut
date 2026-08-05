import { describe, it, expect } from 'vitest';
import { UPGRADES, UPGRADE_IDS, pick3 } from '../src/game/upgrades';
import type { PlayerStats } from '../src/game/entities';

// entities.ts는 최상단에서 `import Phaser from 'phaser'`를 실행하는데, Phaser는 모듈 로드 시점에
// window를 참조해 vitest 기본(node) 환경에서 크래시한다(ReferenceError: window is not defined).
// entities.ts에서 값을 import하는 대신, PlayerStats "타입"만 가져와(런타임에 완전히 소거됨) 고정값을 여기 직접 둔다.
const FIXTURE_STATS: PlayerStats = {
  damage: 1, fireRateMs: 280, moveSpeed: 220, bulletSpeed: 480, pierce: 0, multishot: 1, dashCooldownMs: 2000, maxHp: 5,
};

describe('upgrades', () => {
  it('pick3은 8종 중 서로 다른 3종을 반환한다', () => {
    const picked = pick3();
    expect(picked).toHaveLength(3);
    expect(new Set(picked).size).toBe(3);
    for (const id of picked) expect(UPGRADE_IDS).toContain(id);
  });

  it('apply는 원본을 변조하지 않고 새 스탯에 효과를 반영한다', () => {
    const before = { ...FIXTURE_STATS };

    const damaged = UPGRADES.DAMAGE_UP.apply(before);
    expect(damaged.damage).toBe(before.damage + 1);

    const healed = UPGRADES.HP_PLUS.apply(before);
    expect(healed.maxHp).toBe(before.maxHp + 1);

    expect(before).toEqual(FIXTURE_STATS); // apply가 인자로 받은 stats를 건드리지 않았는지(불변성) 확인
  });

  // 8종 효과값은 브리프 3.2 명시 수치 그대로다 — 리뷰에서 지적된 대로 DAMAGE_UP·HP_PLUS 외 6종도 개별 검증한다.
  it('8종 업그레이드 효과값이 브리프 명시 수치와 정확히 일치한다', () => {
    const s = { ...FIXTURE_STATS };
    expect(UPGRADES.FIRE_RATE_UP.apply(s).fireRateMs).toBeCloseTo(s.fireRateMs * 0.85);
    expect(UPGRADES.MOVE_SPEED_UP.apply(s).moveSpeed).toBeCloseTo(s.moveSpeed * 1.12);
    expect(UPGRADES.PIERCE.apply(s).pierce).toBe(s.pierce + 1);
    expect(UPGRADES.MULTI_SHOT.apply(s).multishot).toBe(s.multishot + 1);
    expect(UPGRADES.BULLET_SPEED_UP.apply(s).bulletSpeed).toBeCloseTo(s.bulletSpeed * 1.2);
    expect(UPGRADES.DASH_CD_DOWN.apply(s).dashCooldownMs).toBeCloseTo(s.dashCooldownMs * 0.8);
  });

  it('HP_PLUS는 상한(8) 이상으로 maxHp를 올리지 않는다', () => {
    const capped = { ...FIXTURE_STATS, maxHp: 8 };
    expect(UPGRADES.HP_PLUS.apply(capped).maxHp).toBe(8);
  });
});
