import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setActiveBuff, clearBuff, getActiveBuff,
  buffedHp, buffedSpeed, buffedFireInterval, buffedKeepDistance, buffedBulletSpeed, buffedSplitCount,
  isIntercept, isEncircle, encircleRadius,
} from '../src/game/buffs';

// mutations.ts는 최상단에서 `import Phaser from 'phaser'`를 실행하는데, Phaser는 모듈 로드 시점에
// window/navigator/document를 참조해 vitest 기본(node) 환경에서 크래시한다(ReferenceError: window is not defined,
// 참고: upgrades.test.ts의 동일 이슈 주석). clearMutation은 인자도 실제 Phaser 객체도 쓰지 않는 경로만 테스트하므로
// (mutation NONE → state는 null → disposables/scene 접근 없이 조기 return) phaser 자체를 더미로 모킹해 우회한다.
vi.mock('phaser', () => ({ default: {} }));
import { clearMutation } from '../src/game/mutations';

beforeEach(() => clearBuff());

describe('활성 카드 상태', () => {
  it('기본은 NONE, 설정·해제가 반영된다', () => {
    expect(getActiveBuff()).toBe('NONE');
    setActiveBuff('TOUGH');
    expect(getActiveBuff()).toBe('TOUGH');
    clearBuff();
    expect(getActiveBuff()).toBe('NONE');
  });
});

describe('TOUGH — 전 적 HP +1', () => {
  it('모든 타입에 +1', () => {
    setActiveBuff('TOUGH');
    expect(buffedHp('chaser', 2)).toBe(3);
    expect(buffedHp('shooter', 3)).toBe(4);
    expect(buffedHp('splitter', 3)).toBe(4);
  });
  it('elite 배수가 이미 적용된 값에도 +1', () => {
    setActiveBuff('TOUGH');
    expect(buffedHp('chaser', 6)).toBe(7);
  });
  it('이속은 건드리지 않는다', () => {
    setActiveBuff('TOUGH');
    expect(buffedSpeed('chaser', 90)).toBe(90);
  });
});

describe('SWIFT — 전 적 이속 +25%', () => {
  it('모든 타입에 ×1.25', () => {
    setActiveBuff('SWIFT');
    expect(buffedSpeed('chaser', 90)).toBeCloseTo(112.5);
    expect(buffedSpeed('shooter', 60)).toBeCloseTo(75);
  });
  it('HP는 건드리지 않는다', () => {
    setActiveBuff('SWIFT');
    expect(buffedHp('chaser', 2)).toBe(2);
  });
});

describe('RELENTLESS — chaser만 이속 +45%·HP −1', () => {
  it('chaser에만 적용된다', () => {
    setActiveBuff('RELENTLESS');
    expect(buffedSpeed('chaser', 90)).toBeCloseTo(130.5);
    expect(buffedHp('chaser', 2)).toBe(1);
    expect(buffedSpeed('shooter', 60)).toBe(60);
    expect(buffedHp('shooter', 3)).toBe(3);
  });
  it('HP는 1 미만으로 내려가지 않는다', () => {
    setActiveBuff('RELENTLESS');
    expect(buffedHp('chaser', 1)).toBe(1);
  });
});

describe('RAPID_FIRE / MARKSMAN — shooter 계열', () => {
  it('RAPID_FIRE는 발사 간격 ×0.6', () => {
    setActiveBuff('RAPID_FIRE');
    expect(buffedFireInterval(1600)).toBeCloseTo(960);
    expect(buffedKeepDistance(260)).toBe(260);
  });
  it('MARKSMAN은 유지거리 +80·탄속 ×1.5', () => {
    setActiveBuff('MARKSMAN');
    expect(buffedKeepDistance(260)).toBe(340);
    expect(buffedBulletSpeed(300)).toBeCloseTo(450);
    expect(buffedFireInterval(1600)).toBe(1600);
  });
});

describe('VOLATILE — 분열 수', () => {
  it('기본 2, VOLATILE이면 3', () => {
    expect(buffedSplitCount()).toBe(2);
    setActiveBuff('VOLATILE');
    expect(buffedSplitCount()).toBe(3);
  });
});

describe('NONE — 아무것도 바꾸지 않는다', () => {
  it('모든 조회가 기본값 그대로', () => {
    expect(buffedHp('chaser', 2)).toBe(2);
    expect(buffedSpeed('chaser', 90)).toBe(90);
    expect(buffedFireInterval(1600)).toBe(1600);
    expect(buffedKeepDistance(260)).toBe(260);
    expect(buffedBulletSpeed(300)).toBe(300);
    expect(buffedSplitCount()).toBe(2);
  });
});

describe('행동 카드', () => {
  it('INTERCEPT/ENCIRCLE 판별이 배타적이다', () => {
    setActiveBuff('INTERCEPT');
    expect(isIntercept()).toBe(true);
    expect(isEncircle()).toBe(false);
    setActiveBuff('ENCIRCLE');
    expect(isIntercept()).toBe(false);
    expect(isEncircle()).toBe(true);
  });
  it('행동 카드는 스탯을 건드리지 않는다', () => {
    setActiveBuff('INTERCEPT');
    expect(buffedHp('chaser', 2)).toBe(2);
    expect(buffedSpeed('chaser', 90)).toBe(90);
    setActiveBuff('ENCIRCLE');
    expect(buffedHp('shooter', 3)).toBe(3);
    expect(buffedFireInterval(1600)).toBe(1600);
  });
  it('포위 반경이 초당 25px씩 줄고 60에서 멈춘다', () => {
    setActiveBuff('ENCIRCLE', 10_000);
    expect(encircleRadius(10_000)).toBe(200);
    expect(encircleRadius(14_000)).toBe(100);      // 4초 × 25 = 100 감소
    expect(encircleRadius(60_000)).toBe(60);       // 하한
  });
  it('clearBuff 후에는 행동 판별이 모두 false다', () => {
    setActiveBuff('ENCIRCLE', 5000);
    clearBuff();
    expect(isIntercept()).toBe(false);
    expect(isEncircle()).toBe(false);
  });
});

describe('누적 방지 — clearMutation이 buff를 리셋한다', () => {
  it('mutation이 NONE이라 state가 없는 웨이브에서도 리셋된다', () => {
    // clearBuff()가 `if (!state) return;` 가드 뒤로 옮겨지면 이 테스트가 깨진다.
    setActiveBuff('TOUGH');
    clearMutation(null as never);
    expect(getActiveBuff()).toBe('NONE');
  });

  it('연속 호출해도 NONE을 유지한다', () => {
    setActiveBuff('VOLATILE');
    clearMutation(null as never);
    clearMutation(null as never);
    expect(getActiveBuff()).toBe('NONE');
  });
});
