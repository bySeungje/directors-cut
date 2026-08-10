import { describe, it, expect } from 'vitest';
import { shouldFire } from '../src/game/fireRule';

/**
 * 실패 축 회귀 가드.
 *
 * 이 프로젝트는 "여전히 너무 쉬워"로 한 번 폐기됐고, 종료 기록(docs/verification/2026-08-08-why-it-stayed-easy.md)이
 * 원인을 밸런스 값이 아니라 **입력 설계**로 특정했다 — 자동 조준·자동 사격이라 공격이 부족해질 수 없었고,
 * 이속 우위라 방어도 부족해질 수 없었다. 예산 곡선·적 이속·선행 조준을 세 번 당겼지만 전부 "적을 강하게"
 * 축이라 실패했다.
 *
 * 그래서 이 테스트가 지키는 것은 밸런스가 아니라 **"플레이어가 쏘지 못하는 상태가 존재한다"**는 사실 하나다.
 * 자동 사격이 어떤 형태로든 다시 들어오면 첫 번째 it()이 깨진다.
 */
describe('수동 발사 — 실패 축', () => {
  const RATE = 200;

  it('포인터를 누르지 않으면 쿨다운이 아무리 지나도 발사하지 않는다', () => {
    expect(shouldFire(false, 0, 0, RATE)).toBe(false);
    expect(shouldFire(false, 10_000, 0, RATE)).toBe(false);
    expect(shouldFire(false, Number.MAX_SAFE_INTEGER, 0, RATE)).toBe(false);
  });

  it('포인터를 눌러도 쿨다운 전에는 발사하지 않는다', () => {
    expect(shouldFire(true, RATE - 1, 0, RATE)).toBe(false);
    expect(shouldFire(true, 0, 0, RATE)).toBe(false);
  });

  it('포인터를 누르고 쿨다운이 지나면 발사한다 (경계 포함)', () => {
    expect(shouldFire(true, RATE, 0, RATE)).toBe(true);
    expect(shouldFire(true, RATE + 1, 0, RATE)).toBe(true);
  });

  it('발사 여부는 적의 존재와 무관하다 — 인자에 적이 없다는 것이 계약이다', () => {
    // shouldFire의 매개변수는 (pointerDown, time, lastFireAt, fireRateMs) 넷뿐이다.
    // 적 목록을 받지 않으므로 "가장 가까운 적이 없으면 발사하지 않는다"는 구 동작이 성립할 수 없고,
    // 따라서 빈 곳을 쏠 수 있다 = 명중률이 100% 미만일 수 있다(sc-miss-possible).
    expect(shouldFire.length).toBe(4);
  });

  it('업그레이드로 fireRateMs가 줄어도 누르지 않으면 여전히 발사하지 않는다', () => {
    // 연사 업그레이드가 축을 되돌리지 않는지 — 카드가 값을 바꿔도 "누름" 조건은 남는다.
    for (const rate of [200, 120, 60, 1]) {
      expect(shouldFire(false, 100_000, 0, rate)).toBe(false);
    }
  });
});
