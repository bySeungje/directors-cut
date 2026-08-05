import { describe, it, expect } from 'vitest';
import { WaveTelemetry } from '../src/telemetry/collector';

describe('WaveTelemetry', () => {
  it('사분면 체류·명중률·킬·피격이 로그로 집계된다', () => {
    const t = new WaveTelemetry();
    // 왼쪽 벽 NW(x=10)에서 2초, 비벽면(480,320 — 정중앙은 strict < 버킷팅으로 SE)에서 1초,
    // 오른쪽 벽 SE(900,500)에서 0.5초 — 벽면·사분면 지표가 서로 다른 값이 되도록 설계
    for (let i = 0; i < 20; i++) t.tick(10, 100, 960, 640, 0.1);
    for (let i = 0; i < 10; i++) t.tick(480, 320, 960, 640, 0.1);
    for (let i = 0; i < 5; i++) t.tick(900, 500, 960, 640, 0.1);
    t.recordShot(true); t.recordShot(true); t.recordShot(false);
    t.recordKill('chaser'); t.recordDamage('shooter'); t.recordDash();
    const log = t.finish(2, 30, ['DAMAGE_UP'], ['NONE']);
    expect(log.wave).toBe(2);
    expect(log.combat.accuracy).toBeCloseTo(2 / 3);
    expect(log.combat.kills.chaser).toBe(1);
    expect(log.damageSources.shooter).toBe(1);
    expect(log.hpLost).toBe(1);
    expect(log.movement.dashCount).toBe(1);
    expect(log.movement.quadrantTime.NW).toBeGreaterThan(0.5); // 2.0/3.5 ≈ 0.57
    expect(log.movement.wallHugRatio).toBeGreaterThan(log.movement.quadrantTime.NW); // 2.5/3.5 ≈ 0.71 — 두 지표 독립 검증(바꿔치기 시 실패)
  });
});
