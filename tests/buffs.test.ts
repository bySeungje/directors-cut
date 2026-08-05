import { describe, it, expect, beforeEach } from 'vitest';
import {
  setActiveBuff, clearBuff, getActiveBuff,
  buffedHp, buffedSpeed, buffedFireInterval, buffedKeepDistance, buffedBulletSpeed, buffedSplitCount,
} from '../src/game/buffs';

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
